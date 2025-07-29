import os
import json
import logging
import csv
import io
from datetime import datetime, timedelta
import requests
import boto3
from flask import Flask, render_template, request, jsonify, redirect, url_for, send_file
from flask_sqlalchemy import SQLAlchemy
from celery import Celery
from werkzeug.utils import secure_filename
import uuid
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'postgresql://localhost/valify_batch')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database
db = SQLAlchemy(app)

# Configure Celery
app.config['CELERY_BROKER_URL'] = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
app.config['CELERY_RESULT_BACKEND'] = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

# Initialize Celery
celery = Celery(app.name, broker=app.config['CELERY_BROKER_URL'])
celery.conf.update(app.config)

# AWS S3 configuration
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY')
)
S3_BUCKET = os.environ.get('S3_BUCKET', 'valify-batch-processing')

# Webhook configuration
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', 'https://your-webhook-endpoint.com/webhook')

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database Models
class BatchJob(db.Model):
    __tablename__ = 'batch_jobs'
    
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.String(50), unique=True, nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    total_leads = db.Column(db.Integer, default=0)
    processed_leads = db.Column(db.Integer, default=0)
    status = db.Column(db.String(50), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime)
    
    validations = db.relationship('LeadValidation', backref='batch', lazy=True)

class LeadValidation(db.Model):
    __tablename__ = 'lead_validations'
    
    id = db.Column(db.Integer, primary_key=True)
    lead_id = db.Column(db.String(100), unique=True, nullable=False)  # first.last.dob
    batch_id = db.Column(db.String(50), db.ForeignKey('batch_jobs.batch_id'))
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))
    dob = db.Column(db.String(10))
    validation_status = db.Column(db.String(50))
    validated_at = db.Column(db.DateTime, default=datetime.utcnow)
    webhook_scheduled_at = db.Column(db.DateTime)
    webhook_sent_at = db.Column(db.DateTime)
    webhook_status = db.Column(db.String(50), default='pending')
    webhook_attempts = db.Column(db.Integer, default=0)

# Create tables
with app.app_context():
    db.create_all()

# Helper Functions
def generate_lead_id(first_name, last_name, dob):
    """Generate lead ID in format: first.last.ddmmyyyy"""
    # Clean names
    first = first_name.lower().strip().replace(' ', '')
    last = last_name.lower().strip().replace(' ', '')
    
    # Convert date format from dd/mm/yyyy to ddmmyyyy
    dob_parts = dob.strip().split('/')
    if len(dob_parts) == 3:
        dob_formatted = f"{dob_parts[0]}{dob_parts[1]}{dob_parts[2]}"
    else:
        dob_formatted = dob.replace('/', '')
    
    return f"{first}.{last}.{dob_formatted}"

def validate_lead_data(lead_data):
    """Validate lead data - simplified version"""
    # In production, this would call your actual validation service
    # For now, we'll do basic validation
    required_fields = ['first_name', 'last_name', 'dob']
    
    for field in required_fields:
        if field not in lead_data or not lead_data[field]:
            return False, f"Missing required field: {field}"
    
    # Validate date format
    try:
        dob_parts = lead_data['dob'].split('/')
        if len(dob_parts) != 3:
            return False, "Invalid date format. Use dd/mm/yyyy"
        
        day, month, year = int(dob_parts[0]), int(dob_parts[1]), int(dob_parts[2])
        datetime(year, month, day)
    except:
        return False, "Invalid date"
    
    # In production, add more validation logic here
    return True, "Valid"

# Celery Tasks
@celery.task(bind=True)
def process_batch(self, batch_id, s3_key):
    """Process a batch of leads from S3"""
    try:
        # Update batch status
        batch = BatchJob.query.filter_by(batch_id=batch_id).first()
        if not batch:
            logger.error(f"Batch {batch_id} not found")
            return
        
        batch.status = 'processing'
        db.session.commit()
        
        # Download file from S3
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        csv_content = response['Body'].read().decode('utf-8')
        
        # Parse CSV
        csv_file = io.StringIO(csv_content)
        reader = csv.DictReader(csv_file)
        
        total_leads = 0
        processed_leads = 0
        
        for row in reader:
            total_leads += 1
            
            try:
                # Generate lead ID
                lead_id = generate_lead_id(row['first_name'], row['last_name'], row['dob'])
                
                # Check if lead already exists
                existing_lead = LeadValidation.query.filter_by(lead_id=lead_id).first()
                if existing_lead:
                    logger.info(f"Lead {lead_id} already exists, skipping")
                    processed_leads += 1
                    continue
                
                # Validate lead
                is_valid, validation_message = validate_lead_data(row)
                
                # Create validation record
                validation = LeadValidation(
                    lead_id=lead_id,
                    batch_id=batch_id,
                    first_name=row['first_name'],
                    last_name=row['last_name'],
                    dob=row['dob'],
                    validation_status='valid' if is_valid else 'invalid',
                    validated_at=datetime.utcnow(),
                    webhook_scheduled_at=datetime.utcnow() + timedelta(hours=24)
                )
                db.session.add(validation)
                db.session.commit()
                
                # Schedule webhook for 24 hours later
                send_webhook.apply_async(
                    args=[validation.id],
                    eta=datetime.utcnow() + timedelta(hours=24)
                )
                
                processed_leads += 1
                
                # Update progress
                if processed_leads % 10 == 0:
                    batch.processed_leads = processed_leads
                    db.session.commit()
                    self.update_state(
                        state='PROGRESS',
                        meta={'current': processed_leads, 'total': total_leads}
                    )
                
            except Exception as e:
                logger.error(f"Error processing lead: {str(e)}")
                continue
        
        # Update batch completion
        batch.total_leads = total_leads
        batch.processed_leads = processed_leads
        batch.status = 'completed'
        batch.completed_at = datetime.utcnow()
        db.session.commit()
        
        logger.info(f"Batch {batch_id} completed. Processed {processed_leads}/{total_leads} leads")
        
    except Exception as e:
        logger.error(f"Error processing batch {batch_id}: {str(e)}")
        if batch:
            batch.status = 'failed'
            db.session.commit()
        raise

@celery.task(bind=True, max_retries=3)
def send_webhook(self, validation_id):
    """Send webhook notification for a validated lead"""
    try:
        validation = LeadValidation.query.get(validation_id)
        if not validation:
            logger.error(f"Validation {validation_id} not found")
            return
        
        # Prepare webhook payload
        payload = {
            "id": validation.lead_id,
            "first_name": validation.first_name,
            "last_name": validation.last_name,
            "dob": validation.dob,
            "validation_status": validation.validation_status,
            "validation_timestamp": validation.validated_at.isoformat(),
            "batch_id": validation.batch_id,
            "webhook_scheduled_for": validation.webhook_scheduled_at.isoformat()
        }
        
        # Send webhook
        headers = {
            'Content-Type': 'application/json',
            'X-Valify-Signature': 'your-signature-here'  # Add proper signature in production
        }
        
        response = requests.post(WEBHOOK_URL, json=payload, headers=headers, timeout=30)
        
        if response.status_code in [200, 201, 202, 204]:
            # Success
            validation.webhook_sent_at = datetime.utcnow()
            validation.webhook_status = 'sent'
            db.session.commit()
            logger.info(f"Webhook sent successfully for lead {validation.lead_id}")
        else:
            # Failed, retry
            raise Exception(f"Webhook failed with status {response.status_code}")
            
    except Exception as e:
        logger.error(f"Error sending webhook for validation {validation_id}: {str(e)}")
        
        # Update attempt count
        validation.webhook_attempts += 1
        db.session.commit()
        
        # Retry with exponential backoff
        retry_in = 60 * (2 ** self.request.retries)  # 1 min, 2 min, 4 min
        self.retry(countdown=retry_in)

# Flask Routes
@app.route('/')
def index():
    """Redirect to batch admin"""
    return redirect(url_for('batch_admin'))

@app.route('/batch_admin')
def batch_admin():
    """Batch upload admin interface"""
    # Get recent batches
    recent_batches = BatchJob.query.order_by(BatchJob.created_at.desc()).limit(10).all()
    return render_template('batch_admin.html', batches=recent_batches)

@app.route('/upload_batch', methods=['POST'])
def upload_batch():
    """Handle batch CSV upload"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not file.filename.endswith('.csv'):
            return jsonify({'error': 'File must be CSV format'}), 400
        
        # Generate batch ID
        batch_id = f"batch_{uuid.uuid4().hex[:8]}"
        
        # Secure filename
        filename = secure_filename(file.filename)
        s3_key = f"batches/{batch_id}/{filename}"
        
        # Upload to S3
        file_content = file.read()
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=file_content
        )
        
        # Create batch job record
        batch = BatchJob(
            batch_id=batch_id,
            filename=filename,
            status='pending'
        )
        db.session.add(batch)
        db.session.commit()
        
        # Trigger batch processing
        process_batch.delay(batch_id, s3_key)
        
        return jsonify({
            'success': True,
            'batch_id': batch_id,
            'message': 'Batch uploaded successfully. Processing started.'
        })
        
    except Exception as e:
        logger.error(f"Error uploading batch: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/batch_status/<batch_id>')
def batch_status(batch_id):
    """Get batch processing status"""
    batch = BatchJob.query.filter_by(batch_id=batch_id).first()
    if not batch:
        return jsonify({'error': 'Batch not found'}), 404
    
    # Get validation summary
    validations = LeadValidation.query.filter_by(batch_id=batch_id).all()
    valid_count = sum(1 for v in validations if v.validation_status == 'valid')
    invalid_count = sum(1 for v in validations if v.validation_status == 'invalid')
    
    # Get webhook status
    webhooks_sent = sum(1 for v in validations if v.webhook_status == 'sent')
    webhooks_pending = sum(1 for v in validations if v.webhook_status == 'pending')
    webhooks_failed = sum(1 for v in validations if v.webhook_status == 'failed')
    
    return jsonify({
        'batch_id': batch.batch_id,
        'filename': batch.filename,
        'status': batch.status,
        'total_leads': batch.total_leads,
        'processed_leads': batch.processed_leads,
        'created_at': batch.created_at.isoformat(),
        'completed_at': batch.completed_at.isoformat() if batch.completed_at else None,
        'validation_summary': {
            'valid': valid_count,
            'invalid': invalid_count
        },
        'webhook_summary': {
            'sent': webhooks_sent,
            'pending': webhooks_pending,
            'failed': webhooks_failed
        }
    })

@app.route('/download_results/<batch_id>')
def download_results(batch_id):
    """Download validation results as CSV"""
    batch = BatchJob.query.filter_by(batch_id=batch_id).first()
    if not batch:
        return jsonify({'error': 'Batch not found'}), 404
    
    # Get all validations for this batch
    validations = LeadValidation.query.filter_by(batch_id=batch_id).all()
    
    # Create CSV
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        'lead_id', 'first_name', 'last_name', 'dob', 
        'validation_status', 'validated_at', 'webhook_status', 'webhook_sent_at'
    ])
    writer.writeheader()
    
    for v in validations:
        writer.writerow({
            'lead_id': v.lead_id,
            'first_name': v.first_name,
            'last_name': v.last_name,
            'dob': v.dob,
            'validation_status': v.validation_status,
            'validated_at': v.validated_at.isoformat(),
            'webhook_status': v.webhook_status,
            'webhook_sent_at': v.webhook_sent_at.isoformat() if v.webhook_sent_at else ''
        })
    
    # Return as file
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode()),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'{batch_id}_results.csv'
    )

@app.route('/webhook_status/<batch_id>')
def webhook_status(batch_id):
    """Get detailed webhook status for a batch"""
    validations = LeadValidation.query.filter_by(batch_id=batch_id).all()
    
    webhook_details = []
    for v in validations:
        webhook_details.append({
            'lead_id': v.lead_id,
            'webhook_status': v.webhook_status,
            'webhook_scheduled_at': v.webhook_scheduled_at.isoformat() if v.webhook_scheduled_at else None,
            'webhook_sent_at': v.webhook_sent_at.isoformat() if v.webhook_sent_at else None,
            'webhook_attempts': v.webhook_attempts
        })
    
    return jsonify({
        'batch_id': batch_id,
        'webhooks': webhook_details
    })

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(debug=True)