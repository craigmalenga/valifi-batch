// js/app.js

// ─── Application State ─────────────────────────────────────────────────────────
const AppState = {
    currentStep: 'step0', // Start with welcome screen
    formData: {},
    lendersList: [],
    foundLenders: [], // Lenders found by Valifi
    additionalLenders: [], // Lenders manually added
    reportData: null, // Stored report data
    identityScore: null,
    otpSent: false,
    otpVerified: false,
    identityVerified: false,
    minimumScore: 40,  // Default, will be updated from server
    changingMobile: false, // Track if we're changing mobile
    signatureSigned: false, // Track if signature is provided
    signatureData: null, // Store signature data URL
    termsAccepted: false, // Track if terms accepted
    termsScrolledToBottom: false, // Track if user scrolled terms to bottom
    valifiReference: null, // Store the valifi reference for batch processing
    flgLeadId: null // Store the FLG lead ID after submission
};

// ─── Utility Functions ─────────────────────────────────────────────────────────
const Utils = {
    // Show loading overlay
    showLoading(text = 'Processing...') {
        const overlay = document.getElementById('loading_overlay');
        const loadingText = overlay.querySelector('.loading-text');
        loadingText.textContent = text;
        overlay.style.display = 'flex';
    },
    
    // Hide loading overlay
    hideLoading() {
        document.getElementById('loading_overlay').style.display = 'none';
    },

    // Show centered error modal
    showErrorModal(message) {
        const modal = document.createElement('div');
        modal.className = 'error-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
            backdrop-filter: blur(5px);
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 3rem;
            border-radius: 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            text-align: center;
            max-width: 500px;
            width: 90%;
            animation: modalBounce 0.5s ease;
        `;
        
        modalContent.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
            <div style="font-size: 1.125rem; color: #2c3e50; margin-bottom: 2rem; line-height: 1.5;">${message}</div>
            <button class="btn btn-primary" style="min-width: 120px;">OK</button>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes modalBounce {
                0% { transform: scale(0.8); opacity: 0; }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        // Event handlers
        modalContent.querySelector('button').addEventListener('click', () => {
            modal.remove();
            style.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                style.remove();
            }
        });
    },

    // Hide error modal (no longer needed with new approach)
    hideErrorModal() {
        // Not used anymore
    },

    // Show error message
    showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    },

    // Clear error message
    clearError(elementId) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
        }
    },

    // Validate email format
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    // Validate UK mobile number
    isValidUKMobile(mobile) {
        const cleaned = mobile.replace(/\D/g, '');
        // Accept both UK format (07...) and international format (447...)
        return /^(07\d{9}|447\d{9}|00447\d{9})$/.test(cleaned);
    },

    // Format UK mobile number
    formatUKMobile(mobile) {
        const cleaned = mobile.replace(/\D/g, '');
        if (cleaned.startsWith('44')) {
            return '0' + cleaned.substring(2);
        }
        if (cleaned.startsWith('0044')) {
            return '0' + cleaned.substring(4);
        }
        return cleaned;
    },

    // Calculate edit distance for fuzzy matching
    editDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let last = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let cur = costs[j - 1];
                    if (s1[i - 1] !== s2[j - 1]) {
                        cur = Math.min(Math.min(cur, last), costs[j]) + 1;
                    }
                    costs[j - 1] = last;
                    last = cur;
                }
            }
            if (i > 0) costs[s2.length] = last;
        }
        return costs[s2.length];
    },

    // Calculate similarity ratio
    similarity(a, b) {
        const [s1, s2] = a.length >= b.length ? [a, b] : [b, a];
        const len = s1.length;
        if (!len) return 1;
        return (len - this.editDistance(s1, s2)) / len;
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Get signature data URL from canvas
    getSignatureDataURL() {
        const canvas = document.getElementById('signature_canvas');
        if (canvas) {
            return canvas.toDataURL('image/png');
        }
        return null;
    }
};

// ─── Form Validation ───────────────────────────────────────────────────────────
const FormValidation = {
    validateStep1() {
        let isValid = true;
        
        // Title validation
        if (!document.getElementById('title').value) {
            Utils.showError('title_error', 'Please select a title');
            isValid = false;
        } else {
            Utils.clearError('title_error');
        }
        
        // First name validation
        const firstName = document.getElementById('first_name').value.trim();
        if (!firstName) {
            Utils.showError('first_name_error', 'First name is required');
            isValid = false;
        } else if (firstName.length < 2) {
            Utils.showError('first_name_error', 'First name must be at least 2 characters');
            isValid = false;
        } else {
            Utils.clearError('first_name_error');
        }
        
        // Last name validation
        const lastName = document.getElementById('last_name').value.trim();
        if (!lastName) {
            Utils.showError('last_name_error', 'Last name is required');
            isValid = false;
        } else if (lastName.length < 2) {
            Utils.showError('last_name_error', 'Last name must be at least 2 characters');
            isValid = false;
        } else {
            Utils.clearError('last_name_error');
        }
        
        // Date of birth validation
        const day = document.getElementById('dob_day').value;
        const month = document.getElementById('dob_month').value;
        const year = document.getElementById('dob_year').value;
        
        if (!day || !month || !year) {
            Utils.showError('dob_error', 'Please enter complete date of birth');
            isValid = false;
        } else if (year.length !== 4 || parseInt(year) < 1900 || parseInt(year) > new Date().getFullYear()) {
            Utils.showError('dob_error', 'Please enter a valid year');
            isValid = false;
        } else {
            Utils.clearError('dob_error');
        }
        
        // Email validation
        const email = document.getElementById('email').value.trim();
        if (!email) {
            Utils.showError('email_error', 'Email address is required');
            isValid = false;
        } else if (!Utils.isValidEmail(email)) {
            Utils.showError('email_error', 'Please enter a valid email address');
            isValid = false;
        } else {
            Utils.clearError('email_error');
        }
        
        return isValid;
    },

    validateStep2() {
        let isValid = true;
        
        const street = document.getElementById('street').value.trim();
        const postTown = document.getElementById('post_town').value.trim();
        const postCode = document.getElementById('post_code').value.trim();
        
        if (!street) {
            Utils.showError('street_error', 'Street is required');
            isValid = false;
        } else {
            Utils.clearError('street_error');
        }
        
        if (!postTown) {
            Utils.showError('post_town_error', 'Town/City is required');
            isValid = false;
        } else {
            Utils.clearError('post_town_error');
        }
        
        if (!postCode) {
            Utils.showError('post_code_error', 'Post code is required');
            isValid = false;
        } else {
            Utils.clearError('post_code_error');
        }
        
        return isValid;
    },

    validateStep3() {
        const mobile = document.getElementById('mobile').value.trim();
        
        if (!mobile) {
            Utils.showError('mobile_error', 'Mobile number is required');
            return false;
        }
        
        if (!Utils.isValidUKMobile(mobile)) {
            Utils.showError('mobile_error', 'Please enter a valid UK mobile number');
            return false;
        }
        
        Utils.clearError('mobile_error');
        return true;
    }
};

// ─── Step Navigation ───────────────────────────────────────────────────────────
const Navigation = {
    showStep(stepId) {
        console.log(`Attempting to show step: ${stepId}`);
        
        // Hide progress bar for step 0 (welcome screen)
        const progressBar = document.getElementById('main_progress_bar');
        if (progressBar) {
            if (stepId === 'step0') {
                progressBar.style.display = 'none';
            } else {
                // MOBILE FIX: Force grid display on mobile, flex on desktop
                if (window.innerWidth <= 768) {
                    progressBar.style.display = 'grid !important';
                } else {
                    progressBar.style.display = 'flex';
                }
            }
        }
        
        // First, hide ALL steps completely
        const allSteps = document.querySelectorAll('.form-step');
        console.log(`Found ${allSteps.length} form steps`);
        
        allSteps.forEach(step => {
            step.style.display = 'none';
            step.style.visibility = 'hidden';
            step.classList.remove('active');
        });
        
        // Clean up duplicate footers - ensure only one page-footer exists
        const footers = document.querySelectorAll('.page-footer');
        if (footers.length > 1) {
            console.log(`Found ${footers.length} footers, removing duplicates`);
            for (let i = 1; i < footers.length; i++) {
                footers[i].remove();
            }
        }
        
        // Also check inside form steps for any nested footers
        allSteps.forEach(step => {
            const nestedFooters = step.querySelectorAll('.page-footer');
            nestedFooters.forEach(footer => footer.remove());
        });
        
        // Then show only the requested step
        const stepElement = document.getElementById(stepId);
        if (stepElement) {
            console.log(`Showing step element: ${stepId}`);
            stepElement.style.display = 'block';
            stepElement.style.visibility = 'visible';
            stepElement.classList.add('active');
            AppState.currentStep = stepId;
            
            // Update progress bar (skip for step0)
            if (stepId !== 'step0') {
                this.updateProgressBar(stepId);
            }
            
            // Save form data
            this.saveFormData();
            
            // Special handling for step 4 to ensure mobile is saved
            if (stepId === 'step4') {
                const mobileInput = document.getElementById('mobile');
                if (mobileInput && mobileInput.value) {
                    AppState.formData.mobile = mobileInput.value;
                }
            }
            
            // Initialize signature canvas when showing step 6
            if (stepId === 'step6') {
                setTimeout(() => {
                    EventHandlers.initSignatureCanvas();
                }, 100);
            }
            
            // Scroll to top of container
            const container = document.querySelector('.container');
            if (container) {
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } else {
            console.error(`Step element not found: ${stepId}`);
        }
    },    

    updateProgressBar(currentStepId) {
        const stepMap = {
            'step1': '1',
            'step2': '2',
            'step3': '3',
            'step4': '4',
            'step5': '5',
            'step6': '6'
        };
        
        const currentStepNumber = stepMap[currentStepId];
        
        document.querySelectorAll('.progress-step').forEach(step => {
            const stepNumber = step.dataset.step;
            step.classList.remove('active', 'completed');
            
            // Mark previous steps as completed
            const stepOrder = ['1', '2', '3', '4', '5', '6'];
            const currentIndex = stepOrder.indexOf(currentStepNumber);
            const stepIndex = stepOrder.indexOf(stepNumber);
            
            if (stepIndex < currentIndex) {
                step.classList.add('completed');
            } else if (stepIndex === currentIndex) {
                step.classList.add('active');
            }
        });
    },

    saveFormData() {
        // Save all form fields to AppState
        const inputs = document.querySelectorAll('input, select');
        inputs.forEach(input => {
            if (input.id && input.value) {
                AppState.formData[input.id] = input.value;
            }
        });
        
        // Specifically ensure mobile is saved
        const mobileInput = document.getElementById('mobile');
        if (mobileInput && mobileInput.value) {
            AppState.formData.mobile = mobileInput.value;
        }
        
        // Debug log to ensure data is saved
        console.log('Form data saved:', AppState.formData);
    },

    populateReviewSummary() {
        const summary = document.getElementById('review_summary');
        const data = AppState.formData;
        
        // Make sure we have the latest mobile value
        const mobileInput = document.getElementById('mobile');
        if (mobileInput) {
            data.mobile = mobileInput.value;
        }
        
        summary.innerHTML = `
            <h3>Your Information</h3>
            <div class="review-item">
                <span class="review-label">Name:</span>
                <span class="review-value">${data.title || ''} ${data.first_name || ''} ${data.middle_name || ''} ${data.last_name || ''}</span>
            </div>
            <div class="review-item">
                <span class="review-label">Date of Birth:</span>
                <span class="review-value">${data.dob_day || ''}/${data.dob_month || ''}/${data.dob_year || ''}</span>
            </div>
            <div class="review-item">
                <span class="review-label">Email:</span>
                <span class="review-value">${data.email || ''}</span>
            </div>
            <div class="review-item">
                <span class="review-label">Mobile:</span>
                <span class="review-value">${data.mobile || ''}</span>
            </div>
            <div class="review-item">
                <span class="review-label">Address:</span>
                <span class="review-value">
                    ${[data.building_number, data.building_name, data.flat, data.street].filter(Boolean).join(', ')}<br>
                    ${data.post_town || ''}<br>
                    ${data.post_code || ''}
                </span>
            </div>
        `;
    }
};

// ─── API Calls ─────────────────────────────────────────────────────────────────
const API = {
    async lookupAddress(postcode) {
        const response = await fetch('/lookup-address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postCode: postcode })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Address lookup failed');
        }
        
        return response.json();
    },

    async sendOTP(mobile) {
        console.log('Sending OTP to:', mobile);
        const response = await fetch('/otp/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile })
        });
        
        const result = await response.json();
        console.log('OTP response:', result);
        
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        
        return result;
    },

    async verifyOTP(mobile, code) {
        const response = await fetch('/otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, code })
        });
        
        return response.json();
    },

    async validateIdentity(data) {
        const response = await fetch('/validate-identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        return response.json();
    },

    async getCreditReport(data) {
        const response = await fetch('/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        // Store the valifi reference if returned
        if (result.valifiReference) {
            AppState.valifiReference = result.valifiReference;
        }
        
        return result;
    },

    async uploadToFLG(data) {
        const response = await fetch('/upload_summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        // Store the FLG lead ID if returned
        if (result.flgLeadId) {
            AppState.flgLeadId = result.flgLeadId;
        }
        
        return result;
    },

    // NEW: Fetch terms content
    async fetchTermsContent() {
        try {
            // In production, this would fetch from your PDF endpoint
            // For now, returning sample terms
            const termsContent = `
                <h3>Terms & Conditions</h3>
                <p><strong>Effective Date: January 2025</strong></p>
                
                <h3>1. Introduction</h3>
                <p>These Terms and Conditions ("Terms") govern your use of the vehicle finance claims service ("Service") provided by Belmond Claims Limited ("we", "us", or "our"). By using our Service, you agree to be bound by these Terms.</p>
                
                <h3>2. Service Description</h3>
                <p>We provide a claims management service to assist you in pursuing compensation for potentially mis-sold vehicle finance agreements. Our services include:</p>
                <ul>
                    <li>Reviewing your vehicle finance agreements</li>
                    <li>Assessing the viability of potential claims</li>
                    <li>Submitting claims to lenders on your behalf</li>
                    <li>Managing all correspondence with lenders</li>
                    <li>Negotiating settlements where applicable</li>
                </ul>
                
                <h3>3. No Win, No Fee</h3>
                <p>Our Service operates on a "no win, no fee" basis, which means:</p>
                <ul>
                    <li>If your claim is unsuccessful, you will not be charged any fees</li>
                    <li>If your claim is successful, our fee will be deducted from the compensation amount</li>
                    <li>Our fees range from 18% to 36% (including VAT) of the total compensation recovered</li>
                    <li>The exact fee percentage depends on the complexity and value of your claim</li>
                </ul>
                
                <h3>4. Your Responsibilities</h3>
                <p>By using our Service, you agree to:</p>
                <ul>
                    <li>Provide accurate, complete, and truthful information</li>
                    <li>Promptly respond to our requests for additional information or documentation</li>
                    <li>Inform us immediately of any changes to your contact details</li>
                    <li>Not pursue the same claim through another claims management company</li>
                    <li>Cooperate fully with us throughout the claims process</li>
                </ul>
                
                <h3>5. Data Protection and Privacy</h3>
                <p>We take your privacy seriously and process your personal data in accordance with:</p>
                <ul>
                    <li>The General Data Protection Regulation (GDPR)</li>
                    <li>The Data Protection Act 2018</li>
                    <li>Our comprehensive Privacy Policy</li>
                </ul>
                <p>Your personal data will be used solely for the purpose of pursuing your claim and will not be shared with third parties except where necessary for the claims process or where required by law.</p>
                
                <h3>6. Cancellation Rights</h3>
                <p>You have the right to cancel this agreement:</p>
                <ul>
                    <li>Within 14 days of signing without any charge</li>
                    <li>After 14 days, you may still cancel but may be liable for costs incurred up to the point of cancellation</li>
                    <li>To cancel, you must notify us in writing via email or post</li>
                </ul>
                
                <h3>7. Limitation of Liability</h3>
                <p>Our liability to you is limited as follows:</p>
                <ul>
                    <li>We are not liable for any indirect or consequential losses</li>
                    <li>Our total liability shall not exceed the fees paid by you</li>
                    <li>We are not responsible for the decisions made by lenders regarding your claim</li>
                </ul>
                
                <h3>8. Complaints Procedure</h3>
                <p>If you are dissatisfied with our service:</p>
                <ul>
                    <li>First, contact us directly to resolve the issue</li>
                    <li>If unresolved, you may escalate to our Complaints Manager</li>
                    <li>You have the right to refer your complaint to the Financial Ombudsman Service</li>
                </ul>
                
                <h3>9. Governing Law</h3>
                <p>These Terms are governed by the laws of England and Wales. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
                
                <h3>10. Contact Information</h3>
                <p>For any questions about these Terms or our Service, please contact us:</p>
                <p>
                    <strong>Email:</strong> support@belmondclaims.com<br>
                    <strong>Phone:</strong> 0330 094 8438<br>
                    <strong>Address:</strong> Belmond Claims Limited, [Your Address]<br>
                    <strong>Hours:</strong> Monday to Friday, 9am - 6pm
                </p>
                
                <h3>11. Updates to Terms</h3>
                <p>We reserve the right to update these Terms at any time. Any changes will be communicated to you via email or through our website. Your continued use of our Service after such changes constitutes acceptance of the updated Terms.</p>
                
                <p style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #ccc;">
                    <strong>By clicking "Accept & Continue" below, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.</strong>
                </p>
            `;
            
            return termsContent;
        } catch (error) {
            console.error('Failed to fetch terms:', error);
            throw error;
        }
    }
};

// ─── Event Handlers ────────────────────────────────────────────────────────────
const EventHandlers = {
    // Initialize all event handlers
    init() {
        // Load lenders data
        this.loadLenders();
        
        // Step 0 handlers
        this.initStep0();
        
        // Step 1 handlers
        this.initStep1();
        
        // Step 2 handlers
        this.initStep2();
        
        // Step 3 handlers
        this.initStep3();
        
        // Step 4 handlers (Review & Submit)
        this.initStep4();
        
        // Step 5 handlers (Your Finance Agreements)
        this.initStep5();
        
        // Step 6 handlers (Final Submit)
        this.initStep6();
        
        // Form submission
        this.initFormSubmission();
        
        // Error modal handler
        this.initErrorModal();
        
        // Mobile responsive handler
        this.initMobileResponsive();
    },

    // NEW: Mobile responsive handler
    initMobileResponsive() {
        // Fix progress bar on resize
        window.addEventListener('resize', () => {
            const progressBar = document.getElementById('main_progress_bar');
            if (progressBar && AppState.currentStep !== 'step0') {
                if (window.innerWidth <= 768) {
                    progressBar.style.cssText = 'display: grid !important;';
                } else {
                    progressBar.style.cssText = 'display: flex !important;';
                }
            }
        });
    },

    async loadLenders() {
        try {
            const response = await fetch('/lenders');
            AppState.lendersList = await response.json();
        } catch (error) {
            console.error('Failed to load lenders:', error);
        }
    },

    initErrorModal() {
        // Error modal is now created dynamically in showErrorModal
        // No initialization needed
    },

    initStep0() {
        // Welcome screen - "Let's get started" button
        console.log('Initializing Step 0...');
        
        const startButton = document.getElementById('start_journey');
        if (startButton) {
            console.log('Found start_journey button, adding event listener');
            startButton.addEventListener('click', () => {
                console.log('Start journey button clicked');
                Navigation.showStep('step1');
            });
        } else {
            console.error('start_journey button not found!');
        }
    },

    initStep1() {
        // Populate DOB dropdowns
        const daySelect = document.getElementById('dob_day');
        const monthSelect = document.getElementById('dob_month');
        
        for (let i = 1; i <= 31; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            daySelect.appendChild(option);
        }
        
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
        months.forEach((month, index) => {
            const option = document.createElement('option');
            option.value = index + 1;
            option.textContent = month;
            monthSelect.appendChild(option);
        });
        
        // Title button group
        document.querySelectorAll('#title_buttons button').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('#title_buttons button').forEach(b => b.classList.remove('active'));
                button.classList.add('active');
                document.getElementById('title').value = button.dataset.value;
                Utils.clearError('title_error');
            });
        });
        
        // Year slider
        const yearInput = document.getElementById('dob_year');
        const yearSlider = document.getElementById('year_slider');
        const sliderTooltip = document.getElementById('slider_tooltip');
        
        // Set slider max to current year - 18 (must be 18+)
        const currentYear = new Date().getFullYear();
        const maxYear = currentYear - 18;
        yearSlider.max = maxYear;
        yearInput.max = maxYear;
        
        // Sync year input with slider
        yearInput.addEventListener('input', () => {
            const year = parseInt(yearInput.value);
            if (year >= 1900 && year <= maxYear) {
                yearSlider.value = year;
            }
        });
        
        // Sync slider with year input
        yearSlider.addEventListener('input', () => {
            yearInput.value = yearSlider.value;
            sliderTooltip.textContent = yearSlider.value;
            sliderTooltip.classList.add('show');
        });
        
        yearSlider.addEventListener('change', () => {
            sliderTooltip.classList.remove('show');
        });
        
        // Clear button
        document.getElementById('clear_step1').addEventListener('click', () => {
            document.getElementById('searchForm').reset();
            document.querySelectorAll('#title_buttons button').forEach(b => b.classList.remove('active'));
            AppState.formData = {};
        });
        
        // Next button
        document.getElementById('next_to_step2').addEventListener('click', () => {
            if (FormValidation.validateStep1()) {
                Navigation.showStep('step2');
            }
        });
    },

    initStep2() {
        // Toggle manual address entry
        const manualToggle = document.getElementById('manual_address_toggle');
        const manualFields = document.getElementById('manual_address_fields');
        
        manualToggle.addEventListener('click', () => {
            if (manualFields.style.display === 'none') {
                manualFields.style.display = 'block';
                manualToggle.textContent = 'Use postcode lookup';
            } else {
                manualFields.style.display = 'none';
                manualToggle.textContent = 'Enter address manually';
            }
        });
        
        // Address lookup
        document.getElementById('address_lookup_btn').addEventListener('click', async () => {
            let postcode = document.getElementById('lookup_postcode').value.trim();
            
            if (!postcode) {
                Utils.showError('address_error', 'Please enter a postcode');
                return;
            }
            
            // Convert postcode to uppercase
            postcode = postcode.toUpperCase();
            document.getElementById('lookup_postcode').value = postcode;
            
            Utils.showLoading('Looking up addresses...');
            Utils.clearError('address_error');
            
            try {
                const data = await API.lookupAddress(postcode);
                const addresses = data.addresses || [];
                
                const addressSelect = document.getElementById('address_select');
                addressSelect.innerHTML = '<option value="">Choose from list...</option>';
                
                if (addresses.length === 0) {
                    Utils.showError('address_error', 'No addresses found for this postcode');
                    document.getElementById('address_container').style.display = 'none';
                } else {
                    // Sort addresses by building number/name for better UX
                    const addressSortKey = (addr) => {
                        // Try to extract building number for sorting
                        let sortKey = '';
                        
                        // First priority: numeric building number
                        if (addr.number) {
                            // Check if it's purely numeric
                            const numMatch = String(addr.number).match(/^(\d+)(.*)$/);
                            if (numMatch) {
                                // Pad numbers for proper sorting (so 2 comes before 10)
                                sortKey = numMatch[1].padStart(4, '0') + (numMatch[2] || '');
                            } else {
                                sortKey = String(addr.number);
                            }
                        }
                        
                        // Add secondary sort by flat/name if they're numbers
                        if (addr.subBuilding) {
                            const flatMatch = addr.subBuilding.match(/FLAT\s+(\d+)/i);
                            if (flatMatch) {
                                sortKey += '_' + flatMatch[1].padStart(3, '0');
                            } else {
                                sortKey += '_' + addr.subBuilding;
                            }
                        } else if (addr.name && !isNaN(addr.name)) {
                            sortKey += '_' + String(addr.name).padStart(3, '0');
                        } else if (addr.name) {
                            sortKey += '_' + addr.name;
                        }
                        
                        return sortKey;
                    };
                    
                    addresses.sort((a, b) => {
                        const keyA = addressSortKey(a);
                        const keyB = addressSortKey(b);
                        return keyA.localeCompare(keyB);
                    });
                    
                    addresses.forEach(addr => {
                        const option = document.createElement('option');
                        option.value = JSON.stringify(addr);
                        
                        // Build address label with all components - ENHANCED VERSION
                        const parts = [];
                        
                        // 1. Add building number first if available
                        if (addr.number) {
                            parts.push(addr.number);
                        }
                        
                        // 2. Handle 'name' field - could be a flat number, floor name, or building name
                        if (addr.name) {
                            // Check if name is a number (likely a flat/apartment number)
                            if (!isNaN(addr.name)) {
                                // If we have both number and numeric name, name is likely a flat
                                if (addr.number) {
                                    parts.push(`Flat ${addr.name}`);
                                } else {
                                    parts.push(addr.name);
                                }
                            } else {
                                // Name is text (like "BASEMENT", "GROUND", "FIRST SECOND", etc.)
                                parts.push(addr.name);
                            }
                        }
                        
                        // 3. Handle subBuilding (usually contains "FLAT X")
                        if (addr.subBuilding) {
                            // Don't duplicate if we already added a flat
                            if (!addr.name || isNaN(addr.name)) {
                                parts.push(addr.subBuilding);
                            }
                        }
                        
                        // 4. Handle flat field if present and not already handled
                        if (addr.flat && !addr.subBuilding && (!addr.name || isNaN(addr.name))) {
                            parts.push(`Flat ${addr.flat}`);
                        }
                        
                        // 5. Add street
                        if (addr.street1) {
                            parts.push(addr.street1);
                        }
                        
                        // 6. Add town
                        if (addr.postTown) {
                            parts.push(addr.postTown);
                        }
                        
                        option.textContent = parts.join(', ');
                        addressSelect.appendChild(option);
                    });
                    
                    document.getElementById('address_container').style.display = 'block';
                }
            } catch (error) {
                Utils.showError('address_error', error.message || 'Address lookup failed');
                document.getElementById('address_container').style.display = 'none';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Address selection
        document.getElementById('address_select').addEventListener('change', (e) => {
            if (!e.target.value) return;
            
            const addr = JSON.parse(e.target.value);
            
            // Populate fields intelligently based on the JSON structure
            
            // Building number - straightforward
            document.getElementById('building_number').value = addr.number || '';
            
            // Building name - use 'name' if it's not a number
            if (addr.name && isNaN(addr.name)) {
                document.getElementById('building_name').value = addr.name;
            } else {
                document.getElementById('building_name').value = '';
            }
            
            // Flat/Unit field - combine various sources
            let flatValue = '';
            
            // Priority 1: subBuilding field (e.g., "FLAT 4")
            if (addr.subBuilding) {
                flatValue = addr.subBuilding;
            }
            // Priority 2: flat field
            else if (addr.flat) {
                flatValue = `Flat ${addr.flat}`;
            }
            // Priority 3: if 'name' is a number and we have a 'number' field, name is likely the flat
            else if (addr.name && !isNaN(addr.name) && addr.number) {
                flatValue = `Flat ${addr.name}`;
            }
            // Priority 4: house field
            else if (addr.house) {
                flatValue = addr.house;
            }
            
            document.getElementById('flat').value = flatValue;
            
            // Street, town, and postcode
            document.getElementById('street').value = addr.street1 || '';
            document.getElementById('post_town').value = addr.postTown || '';
            document.getElementById('post_code').value = addr.postcode || '';
            
            // Clear any validation errors
            Utils.clearError('street_error');
            Utils.clearError('post_town_error');
            Utils.clearError('post_code_error');
        });
        
        // Navigation buttons
        document.getElementById('back_to_step1').addEventListener('click', () => Navigation.showStep('step1'));
        document.getElementById('next_to_step3').addEventListener('click', () => {
            if (FormValidation.validateStep2()) {
                Navigation.showStep('step3');
            }
        });
    },

    initStep3() {
        // Mobile number formatting
        document.getElementById('mobile').addEventListener('input', (e) => {
            const formatted = Utils.formatUKMobile(e.target.value);
            if (formatted !== e.target.value) {
                e.target.value = formatted;
            }
        });
        
        // Send OTP button
        document.getElementById('send_otp').addEventListener('click', async () => {
            if (!FormValidation.validateStep3()) return;
            
            let mobile = document.getElementById('mobile').value.replace(/\D/g, '');
            
            // Convert UK format (07...) to international format (447...)
            if (mobile.startsWith('07')) {
                mobile = '44' + mobile.substring(1);
                console.log('Converted mobile to international format:', mobile);
            }
            
            Utils.showLoading('Sending verification code...');
            
            try {
                const result = await API.sendOTP(mobile);
                
                // More flexible success detection
                if (result.status === true || result.status === "true" || 
                    (result.data && (result.data.result === 'SENT' || result.data.status === true))) {
                    AppState.otpSent = true;
                    document.getElementById('otp_verification').style.display = 'block';
                    document.getElementById('otp_message').textContent = '✓ Code sent! Check your phone.';
                    document.getElementById('otp_message').style.display = 'block';
                    document.getElementById('otp_message').className = 'info-message success';
                    
                    // Focus on OTP input
                    document.getElementById('otp').focus();
                } else {
                    console.error('OTP send failed:', result);
                    throw new Error(result.error || result.message || 'Failed to send OTP');
                }
            } catch (error) {
                console.error('OTP request error:', error);
                document.getElementById('otp_message').textContent = `Failed to send code: ${error.message || 'Unknown error'}`;
                document.getElementById('otp_message').style.display = 'block';
                document.getElementById('otp_message').className = 'info-message error';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Resend OTP
        document.getElementById('resend_otp').addEventListener('click', () => {
            document.getElementById('send_otp').click();
        });
        
        // OTP input formatting
        document.getElementById('otp').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
        });
        
        // Verify OTP button
        document.getElementById('verify_otp').addEventListener('click', async () => {
            let mobile = document.getElementById('mobile').value.replace(/\D/g, '');
            const code = document.getElementById('otp').value.replace(/\D/g, '');
            
            // Convert UK format (07...) to international format (447...)
            if (mobile.startsWith('07')) {
                mobile = '44' + mobile.substring(1);
            }
            
            if (!code || code.length !== 6) {
                Utils.showError('otp_error', 'Please enter a 6-digit code');
                return;
            }
            
            Utils.showLoading('Verifying code...');
            
            try {
                const result = await API.verifyOTP(mobile, code);
                
                // More flexible success detection for OTP verification
                if (result.status === true || result.status === "true" || 
                    (result.data && (result.data.result === 'PASS' || result.data.result === 'VERIFIED' || result.data.status === true))) {
                    AppState.otpVerified = true;
                    document.getElementById('otp_status').textContent = '✓ Mobile Verified Successfully';
                    document.getElementById('otp_status').className = 'status-message success';
                    document.getElementById('next_to_step4').disabled = false;
                    Utils.clearError('otp_error');
                } else {
                    document.getElementById('otp_status').textContent = '✗ Invalid code. Please try again.';
                    document.getElementById('otp_status').className = 'status-message error';
                }
            } catch (error) {
                document.getElementById('otp_status').textContent = '✗ Verification failed. Please try again.';
                document.getElementById('otp_status').className = 'status-message error';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Navigation buttons
        document.getElementById('back_to_step2').addEventListener('click', () => Navigation.showStep('step2'));
        document.getElementById('next_to_step4').addEventListener('click', () => {
            if (AppState.otpVerified) {
                // Save mobile number before proceeding
                const mobileInput = document.getElementById('mobile');
                if (mobileInput) {
                    AppState.formData.mobile = mobileInput.value;
                }
                // Populate review summary before showing step 4
                Navigation.populateReviewSummary();
                Navigation.showStep('step4');
            }
        });
    },

    initStep4() {
        // NEW FLOW: Review & Submit with consent first, then identity verification
        
        // Enable submit button when consent is checked
        const consentCheckbox = document.getElementById('consent_checkbox');
        const submitButton = document.getElementById('submit_and_verify');
        
        consentCheckbox.addEventListener('change', () => {
            submitButton.disabled = !consentCheckbox.checked;
        });
        
        // Credit consent checkbox logic
        const creditConsentCheckbox = document.getElementById('credit_consent_checkbox');
        const nextButton = document.getElementById('next_to_step5');
        
        // Function to check if both consents are given
        const checkBothConsents = () => {
            if (AppState.identityVerified && consentCheckbox.checked && creditConsentCheckbox.checked) {
                nextButton.disabled = false;
            } else {
                nextButton.disabled = true;
            }
        };
        
        creditConsentCheckbox.addEventListener('change', checkBothConsents);
        
        // Submit & Verify Identity button
        document.getElementById('submit_and_verify').addEventListener('click', async () => {
            if (!consentCheckbox.checked) {
                alert('Please confirm your consent to proceed.');
                return;
            }
            
            // If we're changing mobile, allow update
            if (AppState.changingMobile) {
                Navigation.showStep('step3');
                // Reset the mobile verification state
                AppState.otpSent = false;
                AppState.otpVerified = false;
                AppState.changingMobile = false;
                return;
            }
            
            // Step 1: Identity Verification
            Utils.showLoading('Verifying your identity...');
            
            try {
                // Keep mobile in UK format for identity validation
                const mobile = document.getElementById('mobile').value.replace(/\D/g, '');
                
                const data = {
                    title: document.getElementById('title').value,
                    firstName: document.getElementById('first_name').value,
                    middleName: document.getElementById('middle_name').value,
                    lastName: document.getElementById('last_name').value,
                    dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                    mobile: mobile,
                    email: document.getElementById('email').value,
                    building_number: document.getElementById('building_number').value,
                    building_name: document.getElementById('building_name').value,
                    flat: document.getElementById('flat').value,
                    street: document.getElementById('street').value,
                    post_town: document.getElementById('post_town').value,
                    post_code: document.getElementById('post_code').value
                };
                
                const identityResult = await API.validateIdentity(data);
                
                const statusDiv = document.getElementById('identity_status');
                const statusIcon = statusDiv.querySelector('.status-icon');
                const statusTitle = statusDiv.querySelector('.status-title');
                const statusMessage = statusDiv.querySelector('.status-message');
                
                statusDiv.style.display = 'block';
                
                if (identityResult.success && identityResult.passed) {
                    AppState.identityVerified = true;
                    AppState.identityScore = identityResult.identityScore;
                    AppState.minimumScore = identityResult.minimumScore;
                    
                    statusIcon.textContent = '✓';
                    statusIcon.style.color = '#28a745';
                    statusTitle.textContent = 'Identity Verified Successfully';
                    statusMessage.textContent = 'Your identity has been verified successfully.';
                    
                    // Store data for later use
                    AppState.reportData = {
                        ...data,
                        clientReference: 'report'
                    };
                    
                    // Show the continue section with credit consent
                    document.getElementById('verified_continue').style.display = 'block';
                    
                    // Hide change mobile section
                    document.getElementById('change_mobile_section').style.display = 'none';
                    
                    // Check if both consents are given
                    checkBothConsents();
                    
                } else {
                    statusIcon.textContent = '⚠️';
                    statusIcon.style.color = '#dc3545';
                    statusTitle.textContent = 'Verification Failed';
                    statusMessage.innerHTML = 'We were unable to verify your identity. Please try a different mobile number linked to your credit file, or contact us:<br><br>' +
                        '<strong>Email:</strong> <a href="mailto:claim@belmondclaims.com" style="color: #721c24; text-decoration: underline;">claim@belmondclaims.com</a><br>' +
                        '<strong>Phone:</strong> 03300948438<br>' +
                        'Monday to Friday, 9am – 6pm';
                    
                    document.getElementById('next_to_step5').disabled = true;
                    
                    // Show change mobile section
                    document.getElementById('change_mobile_section').style.display = 'block';
                }
            } catch (error) {
                console.error('Verification error:', error);
                Utils.showErrorModal('An error occurred during verification. Please try again.');
                
                document.getElementById('next_to_step5').disabled = true;
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Change mobile button
        const changeMobileBtn = document.getElementById('change_mobile_btn');
        if (changeMobileBtn) {
            changeMobileBtn.addEventListener('click', () => {
                AppState.changingMobile = true;
                Navigation.showStep('step3');
                // Clear previous mobile and OTP state
                document.getElementById('mobile').value = '';
                document.getElementById('otp').value = '';
                document.getElementById('otp_verification').style.display = 'none';
                document.getElementById('otp_message').style.display = 'none';
                document.getElementById('otp_status').textContent = '';
                document.getElementById('next_to_step4').disabled = true;
                AppState.otpSent = false;
                AppState.otpVerified = false;
            });
        }
        
        // Navigation buttons
        document.getElementById('back_to_step3').addEventListener('click', () => Navigation.showStep('step3'));
        document.getElementById('next_to_step5').addEventListener('click', async () => {
            if (AppState.identityVerified && AppState.reportData) {
                // Show step 5 first
                Navigation.showStep('step5');
                // Then retrieve the finance information
                await this.retrieveFinanceInformation();
            }
        });
    },

    async retrieveFinanceInformation() {
        try {
            Utils.showLoading('Searching for your vehicle finance records...');
            
            const result = await API.getCreditReport(AppState.reportData);
            
            if (!result.data) {
                throw new Error('Failed to retrieve vehicle finance information');
            }
            
            // Process and store results
            const summaryReport = result.data.summaryReport || result.data;
            const accounts = summaryReport.accounts || [];
            AppState.foundLenders = accounts;
            
            // Upload to FLG silently in background - but don't include manually added lenders yet
            const mobile = AppState.reportData.mobile;
            const ukMobile = mobile.startsWith('44') ? '0' + mobile.substring(2) : mobile;
            
            const flgData = {
                name: summaryReport.name,
                dateOfBirth: (() => {
                    if (accounts.length > 0 && accounts[0].dob) {
                        const [yyyy, mm, dd] = accounts[0].dob.split('T')[0].split('-');
                        return `${dd}/${mm}/${yyyy}`;
                    }
                    return '';
                })(),
                phone1: ukMobile,
                email: AppState.reportData.email,
                address: [AppState.reportData.building_number, AppState.reportData.building_name, AppState.reportData.flat, AppState.reportData.street].filter(Boolean).join(' '),
                towncity: AppState.reportData.post_town,
                postcode: AppState.reportData.post_code,
                accounts: accounts,
                pdfUrl: result.data.pdfUrl,
                valifiReference: AppState.valifiReference
            };
            
            // Don't upload to FLG yet - wait for final submission with all lenders
            
            // Display results immediately
            this.displayLenders(AppState.foundLenders);
            
        } catch (error) {
            console.error('Finance retrieval error:', error);
            Utils.showErrorModal(`Error: ${error.message || 'Failed to retrieve vehicle finance information'}`);
        } finally {
            Utils.hideLoading();
        }
    },

    initStep5() {
        // Display found lenders when step loads
        // Note: displayLenders will be called when we transition to this step
        
        // Add More Lenders button
        const addMoreBtn = document.getElementById('add_more_lenders_btn');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => {
                this.showLenderModal();
            });
        }
        
        // Navigation
        document.getElementById('next_to_step6').addEventListener('click', () => {
            this.populateFinalLendersList();
            Navigation.showStep('step6');
        });
    },

    initStep6() {
        // View Terms button - NEW IMPLEMENTATION
        const viewTermsBtn = document.getElementById('view_terms_btn');
        if (viewTermsBtn) {
            viewTermsBtn.addEventListener('click', () => {
                this.showTermsModal();
            });
        }
        
        // Final submit
        const submitButton = document.getElementById('final_submit_form');
        submitButton.addEventListener('click', async (e) => {
            e.preventDefault();
            
            if (!AppState.termsAccepted) {
                alert('Please view and accept the terms and conditions to proceed.');
                return;
            }
            
            if (!AppState.signatureSigned) {
                alert('Please provide your signature to proceed.');
                return;
            }
            
            Utils.showLoading('Submitting your claim...');
            
            try {
                // Prepare all lenders data
                const allLenders = [
                    ...AppState.foundLenders.map(lender => ({
                        ...lender,
                        sourcedFrom: 'API'
                    })),
                    ...AppState.additionalLenders.map(lender => ({
                        lenderName: lender.name,
                        accountType: 'HP',
                        accountTypeName: 'Hire Purchase',
                        sourcedFrom: 'MANUAL',
                        startDate: '',
                        endDate: '',
                        currentStatus: 'Unknown',
                        monthlyPayment: '',
                        currentBalance: '',
                        defaultBalance: '',
                        accountNumber: '',
                        address: '',
                        dob: ''
                    }))
                ];
                
                // Get signature data
                const signatureData = AppState.signatureData || Utils.getSignatureDataURL();
                
                // Prepare submission data
                const submissionData = {
                    name: `${AppState.formData.title || ''} ${AppState.formData.first_name || ''} ${AppState.formData.last_name || ''}`.trim(),
                    dateOfBirth: `${AppState.formData.dob_year}-${String(AppState.formData.dob_month).padStart(2, '0')}-${String(AppState.formData.dob_day).padStart(2, '0')}`,
                    phone1: AppState.formData.mobile || '',
                    email: AppState.formData.email || '',
                    address: [AppState.formData.building_number, AppState.formData.building_name, AppState.formData.flat, AppState.formData.street].filter(Boolean).join(' '),
                    towncity: AppState.formData.post_town || '',
                    postcode: AppState.formData.post_code || '',
                    pdfUrl: AppState.foundLenders[0]?.pdfUrl || '',
                    allLenders: allLenders,
                    signature: signatureData,
                    valifiReference: AppState.valifiReference
                };
                
                // Submit to FLG
                await API.uploadToFLG(submissionData);
                
                Utils.hideLoading();
                
                // Show modern success modal
                const modal = document.getElementById('success_modal');
                if (modal) {
                    modal.style.display = 'flex';
                    
                    // Close button handler
                    const closeBtn = modal.querySelector('.success-close');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => {
                            modal.style.display = 'none';
                            // Optionally redirect or close window
                            if (window.opener) {
                                window.close();
                            }
                        });
                    }
                    
                    // Close on background click
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal || e.target.classList.contains('success-modal-overlay')) {
                            modal.style.display = 'none';
                        }
                    });
                }
            } catch (error) {
                Utils.hideLoading();
                Utils.showErrorModal('Failed to submit claim. Please try again.');
            }
        });
        
        // Navigation
        document.getElementById('back_to_step5').addEventListener('click', () => Navigation.showStep('step5'));
    },

    // NEW: Show terms modal with scroll requirement
    async showTermsModal() {
        const modal = document.getElementById('terms_modal');
        const termsContent = document.getElementById('terms_content');
        const termsBody = document.getElementById('terms_body');
        const scrollIndicator = document.getElementById('scroll_indicator');
        const termsCheckbox = document.getElementById('terms_modal_checkbox');
        const checkboxWrapper = document.getElementById('terms_checkbox_wrapper');
        const closeBtn = document.getElementById('close_terms_btn');
        
        // Reset state
        AppState.termsScrolledToBottom = false;
        termsCheckbox.checked = false;
        termsCheckbox.disabled = true;
        checkboxWrapper.classList.add('disabled');
        closeBtn.disabled = true;
        scrollIndicator.classList.remove('hidden');
        
        // Load terms content
        try {
            Utils.showLoading('Loading terms...');
            const content = await API.fetchTermsContent();
            termsContent.innerHTML = content;
            Utils.hideLoading();
        } catch (error) {
            Utils.hideLoading();
            termsContent.innerHTML = '<p style="color: red;">Failed to load terms. Please try again.</p>';
            return;
        }
        
        // Show modal
        modal.style.display = 'flex';
        termsBody.scrollTop = 0;
        
        // Scroll event handler
        const checkScroll = () => {
            const scrollPercentage = ((termsBody.scrollTop + termsBody.clientHeight) / termsBody.scrollHeight) * 100;
            
            if (scrollPercentage >= 95 && !AppState.termsScrolledToBottom) {
                AppState.termsScrolledToBottom = true;
                scrollIndicator.classList.add('hidden');
                termsCheckbox.disabled = false;
                checkboxWrapper.classList.remove('disabled');
            }
        };
        
        termsBody.addEventListener('scroll', checkScroll);
        
        // Checkbox handler
        termsCheckbox.addEventListener('change', () => {
            closeBtn.disabled = !termsCheckbox.checked;
        });
        
        // Close button handler
        closeBtn.addEventListener('click', () => {
            if (termsCheckbox.checked) {
                AppState.termsAccepted = true;
                modal.style.display = 'none';
                
                // Update UI
                document.getElementById('terms_status').style.display = 'block';
                document.getElementById('view_terms_btn').style.display = 'none';
                
                // Check if ready to submit
                this.checkFinalSubmitReady();
            }
        });
        
        // Prevent closing by clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                e.stopPropagation();
            }
        });
    },

    initSignatureCanvas() {
        const canvas = document.getElementById('signature_canvas');
        if (!canvas) {
            console.error('Signature canvas not found');
            return;
        }
        
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        
        // Set canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Set drawing style
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000033';
        
        // Mouse events
        canvas.addEventListener('mousedown', (e) => {
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            ctx.beginPath();
            ctx.moveTo(x, y);
            AppState.signatureSigned = true;
            AppState.signatureData = canvas.toDataURL('image/png');
            EventHandlers.checkFinalSubmitReady();
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            ctx.lineTo(x, y);
            ctx.stroke();
            AppState.signatureData = canvas.toDataURL('image/png');
        });
        
        canvas.addEventListener('mouseup', () => {
            isDrawing = false;
        });
        
        canvas.addEventListener('mouseout', () => {
            isDrawing = false;
        });
        
        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            isDrawing = true;
            ctx.beginPath();
            ctx.moveTo(x, y);
            AppState.signatureSigned = true;
            AppState.signatureData = canvas.toDataURL('image/png');
            EventHandlers.checkFinalSubmitReady();
        }, { passive: false });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!isDrawing) return;
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            ctx.lineTo(x, y);
            ctx.stroke();
            AppState.signatureData = canvas.toDataURL('image/png');
        }, { passive: false });
        
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            isDrawing = false;
        }, { passive: false });
        
        // Clear button
        document.getElementById('clear_signature').addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            AppState.signatureSigned = false;
            AppState.signatureData = null;
            EventHandlers.checkFinalSubmitReady();
        });
        
        // Auto-sign button
        document.getElementById('auto_sign').addEventListener('click', () => {
            // Clear canvas first
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Get user's name
            const firstName = AppState.formData.first_name || 'Signature';
            const lastName = AppState.formData.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim();
            
            // Draw signature
            ctx.font = 'italic 30px "Brush Script MT", cursive';
            ctx.fillStyle = '#000033';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fullName, canvas.width / 2, canvas.height / 2);
            
            AppState.signatureSigned = true;
            AppState.signatureData = canvas.toDataURL('image/png');
            EventHandlers.checkFinalSubmitReady();
        });
    },

    checkFinalSubmitReady() {
        const submitButton = document.getElementById('final_submit_form');
        
        if (AppState.termsAccepted && AppState.signatureSigned) {
            submitButton.disabled = false;
        } else {
            submitButton.disabled = true;
        }
    },

    populateFinalLendersList() {
        const finalList = document.getElementById('final_lenders_list');
        if (!finalList) return;
        
        finalList.innerHTML = '';
        
        // Add found lenders
        AppState.foundLenders.forEach(account => {
            const row = document.createElement('div');
            row.className = 'found-row';
            
            // Icon column
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            
            if (account.logoFile) {
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(account.logoFile)}`;
                img.alt = account.displayName;
                img.className = 'lender-logo';
                img.onerror = function() {
                    iconDiv.innerHTML = `<div class="no-logo">${account.displayName}</div>`;
                };
                iconDiv.appendChild(img);
            } else {
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.textContent = account.displayName || account.lenderName;
                iconDiv.appendChild(noLogo);
            }
            
            // Date column
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date';
            if (account.startDate) {
                try {
                    const date = new Date(account.startDate);
                    const month = date.toLocaleString('default', { month: 'long' });
                    const year = String(date.getFullYear()).slice(-2);
                    dateDiv.textContent = `From ${month} '${year}`;
                } catch(e) {
                    dateDiv.textContent = 'Found by check';
                }
            } else {
                dateDiv.textContent = 'Found by check';
            }
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            finalList.appendChild(row);
        });
        
        // Add manually selected lenders
        AppState.additionalLenders.forEach(lender => {
            const row = document.createElement('div');
            row.className = 'found-row manual-row';
            
            // Icon column
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            
            if (lender.filename) {
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(lender.filename)}`;
                img.alt = lender.name;
                img.className = 'lender-logo';
                img.onerror = function() {
                    iconDiv.innerHTML = `<div class="no-logo">${lender.name}</div>`;
                };
                iconDiv.appendChild(img);
            } else {
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.textContent = lender.name;
                iconDiv.appendChild(noLogo);
            }
            
            // Date column
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date lender-source';
            dateDiv.textContent = 'Added manually';
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            finalList.appendChild(row);
        });
    },

    initFormSubmission() {
        // Form submission is now handled in initStep6
    },

    displayLenders(accounts) {
        const foundList = document.getElementById('found_list');
        const stepHeader = document.querySelector('#step5 .step-header');
        foundList.innerHTML = '';
        
        if (accounts.length === 0) {
            // Update header to indicate no lenders found
            stepHeader.innerHTML = `
                <h2 class="section-heading">Your Lenders</h2>
                <p class="step-subtitle">We couldn't find any finance agreements in our initial check</p>
            `;
            
            foundList.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 2rem;">No finance agreements found in our database. Please use the "Add Lenders Manually" button below if you remember any specific lenders.</p>';
            
            // Change button text to "Add Lenders Manually"
            const addMoreBtn = document.getElementById('add_more_lenders_btn');
            if (addMoreBtn) {
                const btnText = addMoreBtn.querySelector('.btn-text');
                if (btnText) {
                    btnText.textContent = 'Add Lenders Manually';
                } else {
                    addMoreBtn.innerHTML = '<span class="btn-icon">+</span> Add Lenders Manually';
                }
                addMoreBtn.style.display = 'block';
            }
            return;
        }
        
        // Update header to indicate lenders were found
        stepHeader.innerHTML = `
            <h2 class="section-heading">Your Lenders</h2>
            <p class="step-subtitle">We found the following finance agreements from your credit report</p>
        `;
        
        // If only one lender, use centered layout
        if (accounts.length === 1) {
            foundList.style.gridTemplateColumns = '1fr';
            foundList.style.justifyItems = 'center';
        } else {
            foundList.style.gridTemplateColumns = 'repeat(2, 1fr)';
            foundList.style.justifyItems = 'unset';
        }
        
        accounts.forEach(account => {
            const lenderName = account.lenderName || 'Unknown Lender';
            
            // Fuzzy match against lenders list
            let bestMatch = { similarity: 0, lender: null };
            AppState.lendersList.forEach(lender => {
                const similarity = Utils.similarity(lenderName.toLowerCase(), lender.name.toLowerCase());
                if (similarity > bestMatch.similarity) {
                    bestMatch = { similarity, lender };
                }
            });
            
            const useMatch = bestMatch.similarity >= 0.8 && bestMatch.lender;
            const displayName = useMatch ? bestMatch.lender.name : lenderName;
            const logoFile = useMatch ? bestMatch.lender.filename : null;
            
            // Store enhanced account data
            account.displayName = displayName;
            account.logoFile = logoFile;
            
            // Create lender row
            const row = document.createElement('div');
            row.className = 'found-row';
            if (accounts.length === 1) {
                row.style.maxWidth = '400px';
            }
            
            // Icon column
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            
            if (logoFile) {
                // Show ONLY logo when available
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(logoFile)}`;
                img.alt = displayName;
                img.className = 'lender-logo';
                img.onerror = function() {
                    // Fallback to name if logo fails to load
                    iconDiv.innerHTML = `<div class="no-logo">${displayName}</div>`;
                };
                iconDiv.appendChild(img);
            } else {
                // Show name when no logo
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.textContent = displayName;
                iconDiv.appendChild(noLogo);
            }
            
            // Date column
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date';
            if (account.startDate) {
                try {
                    const date = new Date(account.startDate);
                    const month = date.toLocaleString('default', { month: 'long' });
                    const year = String(date.getFullYear()).slice(-2);
                    dateDiv.textContent = `From ${month} '${year}`;
                } catch(e) {
                    dateDiv.textContent = '';
                }
            }
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            foundList.appendChild(row);
        });
        
        // Update combined display if there are additional lenders
        if (AppState.additionalLenders.length > 0) {
            this.updateCombinedLendersDisplay();
        } else {
            // Show the "Add More Lenders" button with correct text
            const addMoreBtn = document.getElementById('add_more_lenders_btn');
            if (addMoreBtn) {
                const btnText = addMoreBtn.querySelector('.btn-text');
                if (btnText) {
                    btnText.textContent = 'Add More Lenders';
                } else {
                    addMoreBtn.innerHTML = '<span class="btn-icon">+</span> Add More Lenders';
                }
                addMoreBtn.style.display = 'block';
            }
        }
    },

    showLenderModal() {
        // Get list of already found lender names to exclude
        const foundLenderNames = AppState.foundLenders.map(account => 
            account.displayName || account.lenderName || ''
        ).filter(name => name.trim() !== '');
        
        // Also get manually added lender names
        const manualLenderNames = AppState.additionalLenders.map(lender => lender.name);
        
        // Combine all existing lenders (found + manual) to prevent duplicates
        const allExistingNames = [...foundLenderNames, ...manualLenderNames];
        
        const modal = document.createElement('div');
        modal.className = 'lenders-modal';
        
        // Filter out already found/added lenders
        const availableLenders = AppState.lendersList.filter(lender => 
            !allExistingNames.some(existingName => 
                Utils.similarity(existingName.toLowerCase(), lender.name.toLowerCase()) >= 0.8
            )
        );
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Select Additional Lenders</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="text" class="lender-search" placeholder="Search lenders...">
                    <div class="lender-grid">
                        ${availableLenders.map(lender => `
                            <div class="lender-grid-item" data-name="${lender.name}" data-filename="${lender.filename || ''}">
                                ${lender.filename ? 
                                    `<img src="/static/icons/${encodeURIComponent(lender.filename)}" alt="${lender.name}" class="lender-grid-logo">` :
                                    `<div class="no-logo-placeholder">${lender.name}</div>`
                                }
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary modal-cancel">Cancel</button>
                    <button class="btn btn-primary modal-save">Add Selected</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Modal functionality
        const selectedLenders = new Set();
        
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelectorAll('.lender-grid-item').forEach(option => {
            option.addEventListener('click', () => {
                const name = option.dataset.name;
                if (selectedLenders.has(name)) {
                    selectedLenders.delete(name);
                    option.classList.remove('selected');
                } else {
                    selectedLenders.add(name);
                    option.classList.add('selected');
                }
            });
        });
        
        modal.querySelector('.lender-search').addEventListener('input', (e) => {
            const search = e.target.value.toLowerCase();
            modal.querySelectorAll('.lender-grid-item').forEach(option => {
                const name = option.dataset.name.toLowerCase();
                option.style.display = name.includes(search) ? 'flex' : 'none';
            });
        });
        
        modal.querySelector('.modal-save').addEventListener('click', () => {
            selectedLenders.forEach(name => {
                const lender = AppState.lendersList.find(l => l.name === name);
                if (lender && !AppState.additionalLenders.find(l => l.name === name)) {
                    AppState.additionalLenders.push(lender);
                }
            });
            modal.remove();
            this.updateCombinedLendersDisplay();
        });
    },

    updateCombinedLendersDisplay() {
        const combinedSection = document.getElementById('combined_lenders_display');
        const combinedList = document.getElementById('combined_lenders_list');
        
        // Clear the found list
        document.getElementById('found_list').innerHTML = '';
        
        // Show combined section
        combinedSection.style.display = 'block';
        
        // Show the "Add More Lenders" button with correct text
        const addMoreBtn = document.getElementById('add_more_lenders_btn');
        if (addMoreBtn) {
            const btnText = addMoreBtn.querySelector('.btn-text');
            if (btnText) {
                btnText.textContent = 'Add More Lenders';
            } else {
                addMoreBtn.innerHTML = '<span class="btn-icon">+</span> Add More Lenders';
            }
            addMoreBtn.style.display = 'block';
        }
        
        // Clear and repopulate with both found and manual lenders
        combinedList.innerHTML = '';
        
        // Determine total count
        const totalLenders = AppState.foundLenders.length + AppState.additionalLenders.length;
        
        // If only one total lender, use centered layout
        if (totalLenders === 1) {
            combinedList.style.gridTemplateColumns = '1fr';
            combinedList.style.justifyItems = 'center';
        } else {
            combinedList.style.gridTemplateColumns = 'repeat(2, 1fr)';
            combinedList.style.justifyItems = 'unset';
        }
        
        // First add found lenders
        AppState.foundLenders.forEach(account => {
            const row = document.createElement('div');
            row.className = 'found-row';
            if (totalLenders === 1) {
                row.style.maxWidth = '400px';
            }
            
            // Icon column
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            
            if (account.logoFile) {
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(account.logoFile)}`;
                img.alt = account.displayName;
                img.className = 'lender-logo';
                img.onerror = function() {
                    iconDiv.innerHTML = `<div class="no-logo">${account.displayName}</div>`;
                };
                iconDiv.appendChild(img);
            } else {
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.textContent = account.displayName || account.lenderName;
                iconDiv.appendChild(noLogo);
            }
            
            // Date column
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date';
            if (account.startDate) {
                try {
                    const date = new Date(account.startDate);
                    const month = date.toLocaleString('default', { month: 'long' });
                    const year = String(date.getFullYear()).slice(-2);
                    dateDiv.textContent = `From ${month} '${year}`;
                } catch(e) {
                    dateDiv.textContent = 'Found by check';
                }
            } else {
                dateDiv.textContent = 'Found by check';
            }
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            combinedList.appendChild(row);
        });
        
        // Then add manually selected lenders
        AppState.additionalLenders.forEach(lender => {
            const row = document.createElement('div');
            row.className = 'found-row manual-row';
            if (totalLenders === 1) {
                row.style.maxWidth = '400px';
            }
            
            // Icon column
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            
            if (lender.filename) {
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(lender.filename)}`;
                img.alt = lender.name;
                img.className = 'lender-logo';
                img.onerror = function() {
                    iconDiv.innerHTML = `<div class="no-logo">${lender.name}</div>`;
                };
                iconDiv.appendChild(img);
            } else {
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.textContent = lender.name;
                iconDiv.appendChild(noLogo);
            }
            
            // Date column
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date lender-source';
            dateDiv.textContent = 'Added manually';
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            combinedList.appendChild(row);
        });
    }
};

// ─── Initialize Application ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    
    // Initialize event handlers
    try {
        EventHandlers.init();
        console.log('EventHandlers initialized successfully');
    } catch (error) {
        console.error('Failed to initialize EventHandlers:', error);
    }
    
    // Start with welcome screen (step 0)
    try {
        Navigation.showStep('step0');
        console.log('Showing step 0 (welcome screen)');
    } catch (error) {
        console.error('Failed to show step 0:', error);
    }
});