// static/js/app.js

// ─── Application State ─────────────────────────────────────────────────────────
const AppState = {
    currentStep: 'step1',
    formData: {},
    lendersList: [],
    identityScore: null,
    otpSent: false,
    otpVerified: false,
    identityVerified: false,
    minimumScore: 40  // Default, will be updated from server
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
        // First, hide ALL steps completely
        const allSteps = document.querySelectorAll('.form-step');
        allSteps.forEach(step => {
            step.style.display = 'none';
            step.style.visibility = 'hidden';
            step.classList.remove('active');
        });
        
        // Then show only the requested step
        const stepElement = document.getElementById(stepId);
        if (stepElement) {
            stepElement.style.display = 'block';
            stepElement.style.visibility = 'visible';
            stepElement.classList.add('active');
            AppState.currentStep = stepId;
            
            // Update progress bar
            this.updateProgressBar(stepId);
            
            // Save form data
            this.saveFormData();
            
            // Scroll to top of container
            const container = document.querySelector('.container');
            if (container) {
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
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
    },

    populateReviewSummary() {
        const summary = document.getElementById('review_summary');
        const data = AppState.formData;
        
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
            const postcode = document.getElementById('lookup_postcode').value.trim();
            
            if (!postcode) {
                Utils.showError('address_error', 'Please enter a postcode');
                return;
            }
            
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
                    addresses.forEach(addr => {
                        const option = document.createElement('option');
                        option.value = JSON.stringify(addr);
                        
                        // Build address label with all components
                        const parts = [];
                        if (addr.number) parts.push(addr.number);
                        if (addr.name) parts.push(addr.name);
                        if (addr.flat) parts.push(addr.flat);
                        if (addr.house) parts.push(addr.house);
                        if (addr.street1) parts.push(addr.street1);
                        if (addr.postTown) parts.push(addr.postTown);
                        
                        option.textContent = parts.join(', ');
                        addressSelect.appendChild(option);
                    });
                    
                    document.getElementById('address_container').style.display = 'block';
                    
                    // Auto-show manual fields
                    document.getElementById('manual_address_fields').style.display = 'block';
                    manualToggle.textContent = 'Hide address fields';
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
            
            // Populate fields intelligently
            document.getElementById('building_number').value = addr.number || '';
            document.getElementById('building_name').value = addr.name || '';
            document.getElementById('flat').value = addr.flat || addr.house || '';
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
                Navigation.showStep('step4');
            }
        });
    },


    initStep4() {
        // Verify Identity button
        document.getElementById('verify_identity').addEventListener('click', async () => {
            // Keep mobile in UK format for identity validation
            const mobile = document.getElementById('mobile').value.replace(/\D/g, '');
            
            const data = {
                title: document.getElementById('title').value,
                firstName: document.getElementById('first_name').value,
                middleName: document.getElementById('middle_name').value,
                lastName: document.getElementById('last_name').value,
                dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                mobile: mobile,  // Keep in UK format (07...)
                email: document.getElementById('email').value,
                building_number: document.getElementById('building_number').value,
                building_name: document.getElementById('building_name').value,
                flat: document.getElementById('flat').value,
                street: document.getElementById('street').value,
                post_town: document.getElementById('post_town').value,
                post_code: document.getElementById('post_code').value
            };
            
            Utils.showLoading('Verifying identity...');
            
            try {
                const result = await API.validateIdentity(data);
                
                const statusDiv = document.getElementById('identity_status');
                const statusIcon = statusDiv.querySelector('.status-icon');
                const statusTitle = statusDiv.querySelector('.status-title');
                const statusMessage = statusDiv.querySelector('.status-message');
                const scoreDisplay = statusDiv.querySelector('.score-display');
                
                statusDiv.style.display = 'block';
                
                if (result.success && result.passed) {
                    AppState.identityVerified = true;
                    AppState.identityScore = result.identityScore;
                    AppState.minimumScore = result.minimumScore;
                    
                    statusIcon.textContent = '✓';
                    statusIcon.style.color = '#28a745';
                    statusTitle.textContent = 'Identity Verified';
                    statusMessage.textContent = 'Your identity has been successfully verified.';
                    
                    // Hide score display completely
                    if (scoreDisplay) {
                        scoreDisplay.style.display = 'none';
                    }
                    
                    document.getElementById('next_to_step5').disabled = false;
                } else {
                    statusIcon.textContent = '⚠️';
                    statusIcon.style.color = '#dc3545';
                    statusTitle.textContent = 'Verification Failed';
                    statusMessage.innerHTML = 'Please try again with a mobile likely linked to your credit file. If you continue to fail this test please email us on <a href="mailto:claim@belmondclaims.com" style="color: #721c24; text-decoration: underline;">claim@belmondclaims.com</a> noting the issue and we will get back to you.';
                    
                    // Hide score display completely
                    if (scoreDisplay) {
                        scoreDisplay.style.display = 'none';
                    }
                    
                    document.getElementById('next_to_step5').disabled = true;
                }
            } catch (error) {
                document.getElementById('identity_status').style.display = 'block';
                document.querySelector('.status-icon').textContent = '✗';
                document.querySelector('.status-title').textContent = 'Verification Error';
                document.querySelector('.status-message').textContent = 'An error occurred during verification. Please try again.';
                
                // Hide score display in error case too
                const scoreDisplay = document.querySelector('.score-display');
                if (scoreDisplay) {
                    scoreDisplay.style.display = 'none';
                }
            } finally {
                Utils.hideLoading();
            }
        });
        
        // Navigation buttons
        document.getElementById('back_to_step3').addEventListener('click', () => Navigation.showStep('step3'));
        document.getElementById('next_to_step5').addEventListener('click', () => {
            if (AppState.identityVerified) {
                Navigation.populateReviewSummary();
                Navigation.showStep('step5');
            }
        });
    },

    initStep5() {
        // Consent checkbox
        const consentCheckbox = document.getElementById('consent_checkbox');
        const submitButton = document.getElementById('submit_form');
        
        consentCheckbox.addEventListener('change', () => {
            submitButton.disabled = !consentCheckbox.checked;
        });
        
        document.getElementById('back_to_step4').addEventListener('click', () => Navigation.showStep('step4'));
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
                const mobile = document.getElementById('mobile').value.replace(/\D/g, '');
                
                const reportData = {
                    title: document.getElementById('title').value,
                    firstName: document.getElementById('first_name').value,
                    middleName: document.getElementById('middle_name').value,
                    lastName: document.getElementById('last_name').value,
                    dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                    mobile: mobile,  // Keep in UK format
                    email: document.getElementById('email').value,
                    building_number: document.getElementById('building_number').value,
                    building_name: document.getElementById('building_name').value,
                    flat: document.getElementById('flat').value,
                    street: document.getElementById('street').value,
                    post_town: document.getElementById('post_town').value,
                    post_code: document.getElementById('post_code').value,
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
                
                // Ensure mobile is in UK format for FLG
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
                    email: reportData.email,
                    address: [reportData.buildingNumber, reportData.buildingName, reportData.flat, reportData.street].filter(Boolean).join(' '),
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
    
    // Ensure step 1 is visible on load
    Navigation.showStep('step1');
});