// static/js/app.js

// ─── Application State ─────────────────────────────────────────────────────────
const AppState = {
    currentStep: 'step1',
    formData: {},
    lendersList: [],
    trustAssessment: null,
    otpSent: false,
    otpVerified: false,
    mobileIdVerified: false,
    identityVerified: false
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
            Utils.showError('post_town_error', 'Post town is required');
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
        // Hide all steps
        document.querySelectorAll('.form-step').forEach(step => {
            step.style.display = 'none';
        });
        
        // Show requested step
        const stepElement = document.getElementById(stepId);
        if (stepElement) {
            stepElement.style.display = 'block';
            AppState.currentStep = stepId;
            
            // Update progress bar
            this.updateProgressBar(stepId);
            
            // Save form data
            this.saveFormData();
        }
    },

    updateProgressBar(currentStepId) {
        const stepMap = {
            'step1': '1',
            'step2': '2',
            'step3': '3',
            'step4': '4',
            'stepMobileId': 'mobileid',
            'stepIdentity': 'identity',
            'step5': '5',
            'step6': '6'
        };
        
        const currentStepNumber = stepMap[currentStepId];
        
        document.querySelectorAll('.progress-step').forEach(step => {
            const stepNumber = step.dataset.step;
            step.classList.remove('active', 'completed');
            
            // Mark previous steps as completed
            const stepOrder = ['1', '2', '3', '4', 'mobileid', 'identity', '5', '6'];
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
    },

    populateReviewSummary() {
        const summary = document.getElementById('review_summary');
        const data = AppState.formData;
        
        summary.innerHTML = `
            <h3>Please Review Your Information:</h3>
            <div class="review-item">
                <strong>Name:</strong> ${data.title || ''} ${data.first_name || ''} ${data.middle_name || ''} ${data.last_name || ''}
            </div>
            <div class="review-item">
                <strong>Date of Birth:</strong> ${data.dob_day || ''}/${data.dob_month || ''}/${data.dob_year || ''}
            </div>
            <div class="review-item">
                <strong>Email:</strong> ${data.email || ''}
            </div>
            <div class="review-item">
                <strong>Mobile:</strong> ${data.mobile || ''}
            </div>
            <div class="review-item">
                <strong>Address:</strong><br>
                ${data.flat || ''} ${data.street || ''}<br>
                ${data.post_town || ''}<br>
                ${data.post_code || ''}
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
        const response = await fetch('/otp/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile })
        });
        
        return response.json();
    },

    async verifyOTP(mobile, code) {
        const response = await fetch('/otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, code })
        });
        
        return response.json();
    },

    async checkMobileId(data) {
        const response = await fetch('/mobile-id/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
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
        
        return response.json();
    },

    async uploadToFLG(data) {
        const response = await fetch('/upload_summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        return response.json();
    }
};

// ─── Event Handlers ────────────────────────────────────────────────────────────
const EventHandlers = {
    // Initialize all event handlers
    init() {
        // Load lenders data
        this.loadLenders();
        
        // Step 1 handlers
        this.initStep1();
        
        // Step 2 handlers
        this.initStep2();
        
        // Step 3 handlers
        this.initStep3();
        
        // Step 4 handlers
        this.initStep4();
        
        // MobileID step handlers
        this.initMobileIdStep();
        
        // Identity step handlers
        this.initIdentityStep();
        
        // Step 5 handlers
        this.initStep5();
        
        // Step 6 handlers
        this.initStep6();
        
        // Form submission
        this.initFormSubmission();
    },

    async loadLenders() {
        try {
            const response = await fetch('/lenders');
            AppState.lendersList = await response.json();
        } catch (error) {
            console.error('Failed to load lenders:', error);
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
        
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
        // Address lookup
        document.getElementById('address_lookup_btn').addEventListener('click', async () => {
            const postcode = document.getElementById('lookup_postcode').value.trim();
            
            if (!postcode) {
                alert('Please enter a postcode');
                return;
            }
            
            Utils.showLoading('Looking up addresses...');
            Utils.clearError('address_error');
            
            try {
                const data = await API.lookupAddress(postcode);
                const addresses = data.addresses || [];
                
                const addressSelect = document.getElementById('address_select');
                addressSelect.innerHTML = '<option value="">Pick an address…</option>';
                
                if (addresses.length === 0) {
                    Utils.showError('address_error', 'No addresses found for this postcode');
                    document.getElementById('address_container').style.display = 'none';
                } else {
                    addresses.forEach(addr => {
                        const option = document.createElement('option');
                        option.value = JSON.stringify(addr);
                        const label = addr.name || addr.flat || addr.house || addr.number || '';
                        option.textContent = `${label} ${addr.street1}, ${addr.postTown}`;
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
            document.getElementById('flat').value = addr.name || addr.flat || addr.house || addr.number || '';
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
            
            const mobile = document.getElementById('mobile').value.replace(/\D/g, '');
            
            Utils.showLoading('Sending OTP...');
            
            try {
                const result = await API.sendOTP(mobile);
                
                if (result.data && result.data.result === 'SENT') {
                    AppState.otpSent = true;
                    document.getElementById('otp_message').textContent = 'OTP sent successfully! Check your phone.';
                    document.getElementById('otp_message').style.display = 'block';
                    document.getElementById('otp_message').className = 'info-message success';
                    document.getElementById('next_to_step4').disabled = false;
                } else {
                    throw new Error('Failed to send OTP');
                }
            } catch (error) {
                document.getElementById('otp_message').textContent = 'Failed to send OTP. Please try again.';
                document.getElementById('otp_message').style.display = 'block';
                document.getElementById('otp_message').className = 'info-message error';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Navigation buttons
        document.getElementById('back_to_step2').addEventListener('click', () => Navigation.showStep('step2'));
        document.getElementById('next_to_step4').addEventListener('click', () => {
            if (AppState.otpSent) {
                Navigation.showStep('step4');
            }
        });
    },

    initStep4() {
        // OTP input formatting
        document.getElementById('otp').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
        });
        
        // Verify OTP button
        document.getElementById('verify_otp').addEventListener('click', async () => {
            const mobile = document.getElementById('mobile').value.replace(/\D/g, '');
            const code = document.getElementById('otp').value.replace(/\D/g, '');
            
            if (!code || code.length !== 6) {
                Utils.showError('otp_error', 'Please enter a 6-digit OTP code');
                return;
            }
            
            Utils.showLoading('Verifying OTP...');
            
            try {
                const result = await API.verifyOTP(mobile, code);
                
                if (result.data && result.data.result === 'PASS') {
                    AppState.otpVerified = true;
                    document.getElementById('otp_status').textContent = '✓ OTP Verified Successfully';
                    document.getElementById('otp_status').className = 'status-message success';
                    document.getElementById('next_to_stepMobileId').disabled = false;
                    Utils.clearError('otp_error');
                } else {
                    document.getElementById('otp_status').textContent = '✗ Invalid OTP. Please try again.';
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
        document.getElementById('back_to_step3').addEventListener('click', () => Navigation.showStep('step3'));
        document.getElementById('next_to_stepMobileId').addEventListener('click', () => {
            if (AppState.otpVerified) {
                Navigation.showStep('stepMobileId');
            }
        });
    },

    initMobileIdStep() {
        // Check Mobile Trust button
        document.getElementById('check_mobile_trust').addEventListener('click', async () => {
            const data = {
                title: document.getElementById('title').value,
                firstName: document.getElementById('first_name').value,
                middleName: document.getElementById('middle_name').value,
                lastName: document.getElementById('last_name').value,
                dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                mobile: document.getElementById('mobile').value.replace(/\D/g, ''),
                email: document.getElementById('email').value,
                flat: document.getElementById('flat').value,
                street: document.getElementById('street').value,
                postTown: document.getElementById('post_town').value,
                postCode: document.getElementById('post_code').value
            };
            
            Utils.showLoading('Performing trust assessment...');
            
            try {
                const result = await API.checkMobileId(data);
                
                if (result.success && result.trustAssessment) {
                    AppState.trustAssessment = result.trustAssessment;
                    this.displayTrustResults(result.trustAssessment);
                    
                    // Enable proceed button if trust is positive or neutral
                    if (result.trustAssessment.recommendation !== 'NEGATIVE') {
                        AppState.mobileIdVerified = true;
                        document.getElementById('next_to_stepIdentity_from_mobile').disabled = false;
                    } else {
                        // Show warning but still allow to proceed with additional verification
                        document.getElementById('trust_warning').style.display = 'block';
                        document.getElementById('trust_warning_text').textContent = 
                            'Your mobile number appears to be associated with different identities. ' +
                            'Additional verification will be required to proceed.';
                        document.getElementById('next_to_stepIdentity_from_mobile').disabled = false;
                    }
                } else {
                    throw new Error('Trust assessment failed');
                }
            } catch (error) {
                document.getElementById('trust_status').style.display = 'block';
                document.querySelector('.trust-text').textContent = 'Trust assessment failed. Please try again.';
                document.querySelector('.trust-icon').textContent = '⚠️';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Navigation buttons
        document.getElementById('back_to_step4_from_mobile').addEventListener('click', () => Navigation.showStep('step4'));
        document.getElementById('next_to_stepIdentity_from_mobile').addEventListener('click', () => {
            if (AppState.mobileIdVerified || AppState.trustAssessment) {
                Navigation.showStep('stepIdentity');
            }
        });
    },

    displayTrustResults(assessment) {
        const statusContainer = document.getElementById('trust_status');
        const iconElement = document.querySelector('.trust-icon');
        const textElement = document.querySelector('.trust-text');
        const detailsList = document.getElementById('trust_details_list');
        
        statusContainer.style.display = 'block';
        
        // Set icon and main message based on recommendation
        switch (assessment.recommendation) {
            case 'POSITIVE':
                iconElement.textContent = '✓';
                iconElement.style.color = '#28a745';
                textElement.textContent = 'Excellent! Your mobile number is strongly verified.';
                break;
            case 'NEUTRAL':
                iconElement.textContent = '✓';
                iconElement.style.color = '#ffc107';
                textElement.textContent = 'Good! Your mobile number has been verified.';
                break;
            case 'NEGATIVE':
                iconElement.textContent = '⚠️';
                iconElement.style.color = '#dc3545';
                textElement.textContent = 'Warning: Additional verification required.';
                break;
        }
        
        // Show detailed results
        if (assessment.details) {
            document.querySelector('.trust-details').style.display = 'block';
            detailsList.innerHTML = '';
            
            if (assessment.details.identityMatches > 0) {
                detailsList.innerHTML += `<li class="positive">✓ Direct identity match found (${assessment.details.identityMatches} sources)</li>`;
            }
            if (assessment.details.linkedMatches > 0) {
                detailsList.innerHTML += `<li class="positive">✓ Linked identity match found (${assessment.details.linkedMatches} sources)</li>`;
            }
            if (assessment.details.addressMatches > 0) {
                detailsList.innerHTML += `<li class="neutral">✓ Address match found (${assessment.details.addressMatches} sources)</li>`;
            }
            if (assessment.details.unknownIdentities > 0) {
                detailsList.innerHTML += `<li class="negative">⚠ Unknown identities detected (${assessment.details.unknownIdentities})</li>`;
            }
            if (assessment.details.unknownAddresses > 0) {
                detailsList.innerHTML += `<li class="negative">⚠ Unknown addresses detected (${assessment.details.unknownAddresses})</li>`;
            }
        }
    },

    initIdentityStep() {
        document.getElementById('verify_identity').addEventListener('click', async () => {
            const data = {
                title: document.getElementById('title').value,
                firstName: document.getElementById('first_name').value,
                middleName: document.getElementById('middle_name').value,
                lastName: document.getElementById('last_name').value,
                dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}T00:00:00`,
                mobile: document.getElementById('mobile').value.replace(/\D/g, ''),
                email: document.getElementById('email').value,
                flat: document.getElementById('flat').value,
                street: document.getElementById('street').value,
                postTown: document.getElementById('post_town').value,
                postCode: document.getElementById('post_code').value
            };
            
            Utils.showLoading('Verifying identity...');
            
            try {
                const result = await API.validateIdentity(data);
                
                if (result.data && result.data.summaryReport && 
                    result.data.summaryReport.data.OtherChecks.IdentityResult === 'Pass') {
                    AppState.identityVerified = true;
                    document.getElementById('identity_status').textContent = '✓ Identity verified successfully';
                    document.getElementById('identity_status').className = 'status-message success';
                    document.getElementById('next_to_step5').disabled = false;
                } else {
                    document.getElementById('identity_status').textContent = '✗ Identity verification failed';
                    document.getElementById('identity_status').className = 'status-message error';
                }
            } catch (error) {
                document.getElementById('identity_status').textContent = '✗ Verification error. Please try again.';
                document.getElementById('identity_status').className = 'status-message error';
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Navigation buttons
        document.getElementById('back_to_stepMobileId').addEventListener('click', () => Navigation.showStep('stepMobileId'));
        document.getElementById('next_to_step5').addEventListener('click', () => {
            if (AppState.identityVerified) {
                Navigation.populateReviewSummary();
                Navigation.showStep('step5');
            }
        });
    },

    initStep5() {
        document.getElementById('back_to_stepIdentity').addEventListener('click', () => Navigation.showStep('stepIdentity'));
    },

    initStep6() {
        document.getElementById('add_lender_btn').addEventListener('click', () => {
            Navigation.showStep('step3');
        });
    },

    initFormSubmission() {
        document.getElementById('searchForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitButton = e.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            
            Utils.showLoading('Retrieving credit report...');
            
            try {
                // Prepare data for credit report
                const reportData = {
                    title: document.getElementById('title').value,
                    firstName: document.getElementById('first_name').value,
                    middleName: document.getElementById('middle_name').value,
                    lastName: document.getElementById('last_name').value,
                    dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                    mobile: document.getElementById('mobile').value.replace(/\D/g, ''),
                    email: document.getElementById('email').value,
                    flat: document.getElementById('flat').value,
                    street: document.getElementById('street').value,
                    postTown: document.getElementById('post_town').value,
                    postCode: document.getElementById('post_code').value,
                    clientReference: 'report'
                };
                
                // Get credit report
                const result = await API.getCreditReport(reportData);
                
                if (!result.data) {
                    throw new Error('Failed to retrieve credit report');
                }
                
                // Process and display results
                const summaryReport = result.data.summaryReport || result.data;
                const accounts = summaryReport.accounts || [];
                
                // Show raw data (for debugging)
                document.getElementById('result').textContent = JSON.stringify(accounts, null, 2);
                document.getElementById('result').style.display = 'block';
                
                // Upload to FLG
                Utils.showLoading('Uploading to FLG...');
                
                const flgData = {
                    name: summaryReport.name,
                    dateOfBirth: (() => {
                        if (accounts.length > 0 && accounts[0].dob) {
                            const [yyyy, mm, dd] = accounts[0].dob.split('T')[0].split('-');
                            return `${dd}/${mm}/${yyyy}`;
                        }
                        return '';
                    })(),
                    phone1: reportData.mobile,
                    email: reportData.email,
                    address: reportData.flat ? `${reportData.flat} ${reportData.street}` : reportData.street,
                    towncity: reportData.postTown,
                    postcode: reportData.postCode,
                    accounts: accounts,
                    pdfUrl: result.data.pdfUrl
                };
                
                const flgResult = await API.uploadToFLG(flgData);
                
                // Display FLG status
                const flgStatus = document.getElementById('flg_status');
                if (flgResult.success) {
                    flgStatus.textContent = '✓ FLG upload succeeded';
                    flgStatus.className = 'status-container success';
                } else {
                    flgStatus.textContent = `✗ FLG upload failed: ${flgResult.error || 'Unknown error'}`;
                    flgStatus.className = 'status-container error';
                }
                
                // Display debug info if available
                if (flgResult.debug_data32 || flgResult.debug_flg_xml) {
                    const debugContainer = document.getElementById('debug_container');
                    debugContainer.innerHTML = `
                        <h4>🔍 FLG Debug Info</h4>
                        ${flgResult.debug_data32 ? `<p><strong>Data32:</strong><pre>${flgResult.debug_data32}</pre></p>` : ''}
                        ${flgResult.debug_lenders ? `<p><strong>Lenders:</strong> ${flgResult.debug_lenders}</p>` : ''}
                        ${flgResult.debug_flg_xml ? `<details><summary>Full XML</summary><pre>${flgResult.debug_flg_xml}</pre></details>` : ''}
                    `;
                    debugContainer.style.display = 'block';
                }
                
                // Download PDF if available
                if (result.data.pdfReport) {
                    const binary = atob(result.data.pdfReport);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    
                    const blob = new Blob([bytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'credit_report.pdf';
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    URL.revokeObjectURL(url);
                }
                
                // Display lenders in Step 6
                this.displayLenders(accounts);
                Navigation.showStep('step6');
                
            } catch (error) {
                console.error('Submission error:', error);
                alert(`Error: ${error.message || 'Submission failed'}`);
            } finally {
                Utils.hideLoading();
                submitButton.disabled = false;
            }
        });
    },

    displayLenders(accounts) {
        const foundList = document.getElementById('found_list');
        foundList.innerHTML = '';
        
        accounts.forEach(account => {
            const lenderName = account.lenderName || '';
            
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
            
            // Create lender row
            const row = document.createElement('div');
            row.className = 'found-row';
            
            // Icon
            const iconDiv = document.createElement('div');
            iconDiv.className = 'lender-icon';
            if (logoFile) {
                const img = document.createElement('img');
                img.src = `/static/icons/${encodeURIComponent(logoFile)}`;
                img.alt = displayName;
                img.className = 'lender-logo';
                iconDiv.appendChild(img);
            } else {
                const noLogo = document.createElement('div');
                noLogo.className = 'no-logo';
                noLogo.innerHTML = '<span>No Logo</span>';
                iconDiv.appendChild(noLogo);
            }
            
            // Name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'lender-name';
            nameDiv.textContent = displayName;
            
            // Date
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date';
            if (account.startDate) {
                const date = new Date(account.startDate);
                const month = date.toLocaleString('default', { month: 'long' });
                const year = String(date.getFullYear()).slice(-2);
                dateDiv.textContent = `From ${month} '${year}`;
            }
            
            row.appendChild(iconDiv);
            row.appendChild(nameDiv);
            row.appendChild(dateDiv);
            foundList.appendChild(row);
        });
    }
};

// ─── Initialize Application ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    EventHandlers.init();
});