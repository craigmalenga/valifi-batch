// js/app.js

// --- Application State --------------------------------------------------------------------------------------------------------
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
    cmcDetectedInReport: false,  // Track if CMC was detected
    cmcModalHandled: false,      // Track if modal was already shown
    minimumScore: 40,  // Default, will be updated from server
    changingMobile: false, // Track if we're changing mobile
    signatureSigned: false, // Track if signature is provided
    termsAccepted: false, // Track if terms accepted
    signatureBase64: null, // Store base64 signature
    valifiResponse: null,  // Store full Valifi response
    claimSubmitted: false,  // Track if claim has been submitted
    campaign: null,  // Store campaign parameter from URL
    valifyDebugData: null,  // Store Valify response for debugging
    previousAddressCount: 0,  // Track number of previous addresses added
    currentSubstep: '1a',  // '1a', '1b', or '1c'
    addresses: {  // Store all addresses
        current: {},
        previous1: {},
        previous2: {}
    },
    // NEW: Track consent states
    motorFinanceConsent: false,
    irresponsibleLendingConsent: false,
    // ADD THIS NEW TRACKING OBJECT:
    tracking: {
        source: null,
        medium: null,
        term: null,
        campaign: null
    },
    // MOVED THESE INSIDE THE OBJECT:
    existingRepresentationConsent: null,  // 'No' or 'Yes'
    selectedProfessionalReps: [],  // Array of selected firm IDs
    mammothPromotionsConsent: null
};



// ===== TRACKING CONFIGURATION =====
const TRACKING_CONFIG = {
    COOKIE_NAME: '_belmondpcp_tracking',
    COOKIE_DURATION_DAYS: window.TRACKING_CONFIG?.COOKIE_DAYS || 30,
    ATTRIBUTION_MODEL: 'first-touch'
};

// Comparison sites list
const COMPARISON_SITES = [
    'confused.com',
    'gocompare.com',
    'comparethemarket.com',
    'moneysupermarket.com',
    'uswitch.com',
    'moneysavingexpert.com',
    'which.co.uk',
    'moneyhelper.org.uk',
    'finder.com',
    'trustpilot.com',
    'trustpilot.co.uk',
    'reviews.co.uk',
    'reviews.io',
    'feefo.com'
];

// Add this function to handle CMC detection check
function checkCMCDetection() {
    // Check if valifi is in the credit report
    if (AppState.valifiResponse) {
        const responseStr = JSON.stringify(AppState.valifiResponse).toLowerCase();
        AppState.cmcDetectedInReport = responseStr.includes('valifi');
        console.log('CMC detected in report:', AppState.cmcDetectedInReport);
    }
}

// ===== TRACKING SYSTEM =====
const TrackingSystem = {
    // Cookie helpers
    setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        const cookieValue = JSON.stringify(value);
        document.cookie = `${name}=${encodeURIComponent(cookieValue)};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
    },

    getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) {
                try {
                    return JSON.parse(decodeURIComponent(c.substring(nameEQ.length)));
                } catch (e) {
                    console.error('Failed to parse cookie:', e);
                    return null;
                }
            }
        }
        return null;
    },

    // Extract domain from URL
    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return null;
        }
    },

    // Check if domain is a comparison site
    isComparisonSite(domain) {
        return COMPARISON_SITES.some(site => domain.includes(site));
    },

    // Detect tracking from referrer
    detectFromReferrer() {
        const referrer = document.referrer;
        
        if (!referrer) {
            return {
                source: 'direct',
                medium: 'none',
                term: '',
                timestamp: new Date().toISOString()
            };
        }

        const domain = this.extractDomain(referrer);
        if (!domain) {
            return {
                source: 'direct',
                medium: 'none',
                term: '',
                timestamp: new Date().toISOString()
            };
        }

        // Check for known platforms
        if (domain.includes('google.')) {
            return {
                source: 'google',
                medium: 'organic',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('bing.')) {
            return {
                source: 'bing',
                medium: 'organic',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('facebook.') || domain.includes('fb.com')) {
            return {
                source: 'facebook',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('instagram.')) {
            return {
                source: 'instagram',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('tiktok.')) {
            return {
                source: 'tiktok',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('youtube.')) {
            return {
                source: 'youtube',
                medium: 'video',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('twitter.') || domain.includes('x.com')) {
            return {
                source: 'twitter',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('linkedin.')) {
            return {
                source: 'linkedin',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('pinterest.')) {
            return {
                source: 'pinterest',
                medium: 'social',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }
        
        if (domain.includes('belmondclaims.')) {
            return {
                source: 'belmondclaims',
                medium: 'referral',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }

        // Check if comparison site
        if (this.isComparisonSite(domain)) {
            return {
                source: 'comparison-site',
                medium: 'referral',
                term: domain,
                timestamp: new Date().toISOString()
            };
        }

        // Generic referral
        return {
            source: 'referral',
            medium: 'referral',
            term: domain,
            timestamp: new Date().toISOString()
        };
    },

    // Extract UTM parameters
    extractUTMFromURL(urlParams) {
        const utmSource = urlParams.get('utm_source');
        const utmMedium = urlParams.get('utm_medium');
        const utmTerm = urlParams.get('utm_term');
        const utmCampaign = urlParams.get('utm_campaign');

        if (!utmSource) return null;

        return {
            source: utmSource,
            medium: utmMedium || '',
            term: utmCampaign || utmTerm || '',  // Campaign goes to term
            campaign: utmCampaign || '',
            timestamp: new Date().toISOString()
        };
    },


    // Legacy campaign parameter
    extractCampaignParameter(urlParams) {
        const campaign = urlParams.get('campaign');
        
        if (!campaign) return null;

        return {
            source: 'belmondclaims.com',
            medium: 'belmondclaims.com',  // Changed from 'referral'
            term: campaign,  // Store the campaign value here
            campaign: campaign,
            timestamp: new Date().toISOString()
        };
    },

    // Custom underscore parameter (NEW)
    extractCustomCampaignParameter(urlParams) {
        for (let [key, value] of urlParams) {
            if (key.startsWith('_')) {
                const campaignCode = key.substring(1);
                
                return {
                    source: 'belmondclaims.com',
                    medium: 'QR code',  // QR code as the medium
                    term: campaignCode,  // Store the campaign code in term
                    campaign: campaignCode,
                    timestamp: new Date().toISOString()
                };
            }
        }
        return null;
    },


    // Main tracking capture
    captureTracking() {
        const urlParams = new URLSearchParams(window.location.search);
        let trackingData = null;

        // Priority 1: UTM parameters
        trackingData = this.extractUTMFromURL(urlParams);
        
        // Priority 2: Custom underscore parameters
        if (!trackingData) {
            trackingData = this.extractCustomCampaignParameter(urlParams);
        }
        
        // Priority 3: Legacy campaign parameter
        if (!trackingData) {
            trackingData = this.extractCampaignParameter(urlParams);
        }

        // Priority 4: Check existing cookie (for first-touch attribution)
        const existingCookie = this.getCookie(TRACKING_CONFIG.COOKIE_NAME);


        // Priority 5: Detect from referrer
        if (!trackingData && !existingCookie) {
            trackingData = this.detectFromReferrer();
        }

        // First-touch attribution logic
        if (TRACKING_CONFIG.ATTRIBUTION_MODEL === 'first-touch') {
            // If we have an existing cookie and no new UTM/campaign params, use the cookie
            if (existingCookie && !urlParams.has('utm_source') && !urlParams.has('campaign')) {
                trackingData = existingCookie;
                console.log('Using existing cookie (first-touch attribution):', trackingData);
            }
            // If we have new UTM or campaign data, update cookie
            else if (trackingData && (urlParams.has('utm_source') || urlParams.has('campaign'))) {
                this.setCookie(
                    TRACKING_CONFIG.COOKIE_NAME, 
                    trackingData, 
                    TRACKING_CONFIG.COOKIE_DURATION_DAYS
                );
                console.log('New tracking parameters detected, updating cookie:', trackingData);
            }
            // If no cookie exists yet and we have tracking data, create one
            else if (!existingCookie && trackingData) {
                this.setCookie(
                    TRACKING_CONFIG.COOKIE_NAME, 
                    trackingData, 
                    TRACKING_CONFIG.COOKIE_DURATION_DAYS
                );
                console.log('Creating new tracking cookie:', trackingData);
            }
        }

        // Store in AppState
        AppState.tracking = trackingData || {
            source: 'direct',
            medium: 'none',
            term: '',
            campaign: ''
        };
        
        // Keep legacy campaign support for backward compatibility
        AppState.campaign = AppState.tracking.campaign || AppState.tracking.term || AppState.tracking.medium;

        console.log('Tracking captured:', AppState.tracking);
        console.log('Cookie status:', this.getCookie(TRACKING_CONFIG.COOKIE_NAME));
    },

    // Debug function for testing
    debugTracking() {
        console.group('ðŸ” Tracking Debug Information');
        console.log('Current URL:', window.location.href);
        console.log('URL Parameters:', window.location.search);
        console.log('Referrer:', document.referrer);
        console.log('Cookie:', this.getCookie(TRACKING_CONFIG.COOKIE_NAME));
        console.log('AppState.tracking:', AppState.tracking);
        console.log('AppState.campaign:', AppState.campaign);
        console.log('Cookie Config:', {
            name: TRACKING_CONFIG.COOKIE_NAME,
            duration: TRACKING_CONFIG.COOKIE_DURATION_DAYS,
            model: TRACKING_CONFIG.ATTRIBUTION_MODEL
        });
        console.groupEnd();
    }
};


// Initialize tracking on page load
TrackingSystem.captureTracking();

// Expose to window for debugging (remove in production)
window.TrackingSystem = TrackingSystem;


// Helper function for consistent scrolling with offset
function scrollToElement(element, offset = -30) {
    if (!element) return;
    
    const yOffset = offset; // negative value to show space above
    const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
    
    window.scrollTo({
        top: y,
        behavior: 'smooth'
    });
}

// Helper function to format date from YYYY-MM-DD to DD-MM-YYYY
function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    // Check if it's in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

// TLW Solicitors Modal Functions
function showTLWModal() {
    const modal = document.getElementById('tlwModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeTLWModal() {
    const modal = document.getElementById('tlwModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Highlight forward navigation buttons when they become enabled
function highlightButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (btn && !btn.disabled) {
        // Temporarily increase the animation
        btn.style.animationDuration = '0.8s';
        setTimeout(() => {
            btn.style.animationDuration = '1.5s';
        }, 3000);
        
        // Auto-scroll to button on mobile
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                btn.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }, 200);
        }
    }
}

// Validate Step 1 fields and show/hide next button
// Track current substep
let currentSubstep = '1a';

function validateStep1() {
    const titleEl = document.getElementById('title');
    if (titleEl && !titleEl.value) {
        titleEl.value = 'Mr';
    }
    
    updateContinueButtonForSubstep();
}

function showSubstep(substep) {
    currentSubstep = substep;
    
    const substep1a = document.getElementById('substep1a');
    const substep1b = document.getElementById('substep1b');
    const substep1c = document.getElementById('substep1c');
    
    // Instantly scroll to top BEFORE showing substep (no visible scroll animation)
    window.scrollTo(0, 0);
    
    // Hide all substeps first
    if (substep1a) substep1a.style.display = 'none';
    if (substep1b) substep1b.style.display = 'none';
    if (substep1c) substep1c.style.display = 'none';
    
    // Show the current substep
    if (substep === '1a' && substep1a) {
        substep1a.style.display = 'block';
    } else if (substep === '1b' && substep1b) {
        substep1b.style.display = 'block';
    } else if (substep === '1c' && substep1c) {
        substep1c.style.display = 'block';
        // Extra scroll reset for 1c to prevent any delayed scroll
        setTimeout(() => window.scrollTo(0, 0), 50);
    }
    
    // Always validate to update button state
    validateStep1();
    
    // Update progress bar for substep
    if (typeof Navigation !== 'undefined' && Navigation.updateProgressBar) {
        Navigation.updateProgressBar('step1', substep);
    }
    
    // Track substep for analytics
    if (typeof VisitorTracking !== 'undefined') {



        VisitorTracking.trackFormEvent('substep_change', `step1${substep.substring(1)}`);
    }
}

function advanceSubstep() {
    const firstName = document.getElementById('first_name')?.value?.trim() || '';
    const lastName = document.getElementById('last_name')?.value?.trim() || '';
    const day = document.getElementById('dob_day')?.value || '';
    const month = document.getElementById('dob_month')?.value || '';
    const year = document.getElementById('dob_year')?.value || '';
    const email = document.getElementById('email')?.value?.trim() || '';
    
    if (currentSubstep === '1a' && firstName && lastName) {
        showSubstep('1b');
    } else if (currentSubstep === '1b' && day && month && year) {
        showSubstep('1c');
    } else if (currentSubstep === '1c' && email) {
        // Validate to enable button, then click if enabled
        validateStep1();
        const nextBtn = document.getElementById('next_to_step2');
        if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
        }
    }
}

function updateContinueButtonForSubstep() {
    const firstName = document.getElementById('first_name')?.value?.trim() || '';
    const lastName = document.getElementById('last_name')?.value?.trim() || '';
    const day = document.getElementById('dob_day')?.value || '';
    const month = document.getElementById('dob_month')?.value || '';
    const year = document.getElementById('dob_year')?.value || '';
    const email = document.getElementById('email')?.value?.trim() || '';
    
    const substep1aComplete = !!(firstName && lastName);
    const substep1bComplete = !!(day && month && year);
    const substep1cComplete = !!email;
    
    const nextBtn = document.getElementById('next_to_step2');
    if (!nextBtn) return;
    
    // Determine if Continue should be enabled based on current substep
    let shouldEnable = false;
    
    if (currentSubstep === '1a') {
        // On 1a: enable if 1a complete (will go to 1b)
        shouldEnable = substep1aComplete;
    } else if (currentSubstep === '1b') {
        // On 1b: enable if 1a AND 1b complete (will go to 1c)
        shouldEnable = substep1aComplete && substep1bComplete;
    } else if (currentSubstep === '1c') {
        // On 1c: enable if ALL complete (will go to step 2)
        shouldEnable = substep1aComplete && substep1bComplete && substep1cComplete;
    }
    
    if (shouldEnable) {
        nextBtn.disabled = false;
        nextBtn.classList.remove('btn-disabled');
        highlightButton('next_to_step2');
    } else {
        nextBtn.disabled = true;
        nextBtn.classList.add('btn-disabled');
        nextBtn.style.boxShadow = 'none';
    }
    
    // Show/hide back button
    const backBtn = document.getElementById('back_substep');
    if (backBtn) {
        backBtn.style.display = (currentSubstep === '1a') ? 'none' : 'inline-block';
    }
}


function goBackSubstep() {
    if (currentSubstep === '1b') {
        showSubstep('1a');
    } else if (currentSubstep === '1c') {
        showSubstep('1b');
    }
}

// Call validation immediately when page loads and when form is restored
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(validateStep1, 100);
});

// Validate Step 2 address and show/hide next button
function validateStep2() {
    const hasAddress = AppState.addresses && AppState.addresses.current && AppState.addresses.current.post_code;
    
    const nextBtn = document.getElementById('next_to_step3');
    if (nextBtn) {
        if (hasAddress) {
            nextBtn.disabled = false;
            highlightButton('next_to_step3');
        } else {
            nextBtn.disabled = true;
        }
    }
}


// Add TLW Modal HTML when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (!document.getElementById('tlwModal')) {
        const tlwModalHTML = `
            <div id="tlwModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 10000;">
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 10px; max-width: 500px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);">
                    <div style="padding: 20px; border-bottom: 1px solid #dee2e6;">
                        <h3 style="margin: 0; font-size: 1.5rem; font-weight: 600;">Joint Representation</h3>
                    </div>
                    <div style="padding: 20px;">
                        <p>We operate in partnership with TLW Solicitors. We propose that they continue to represent you in relation to your Motor Finance Commission Claim, but that we additionally pursue Irresponsible Lending & Affordability claims where applicable.</p>
                    </div>
                    <div style="padding: 15px 20px; border-top: 1px solid #dee2e6; text-align: right;">
                        <button class="btn btn-primary" onclick="closeTLWModal()" style="padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 5px; cursor: pointer;">I Understand</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', tlwModalHTML);
    }
});



// --- Utility Functions --------------------------------------------------------------------------------------------------------
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

    showErrorModal(message) {
        const modal = document.createElement('div');
        modal.className = 'error-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(33, 32, 69, 0.9) 0%, rgba(46, 86, 82, 0.9) 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
            backdrop-filter: blur(10px);
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 3rem;
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(33, 32, 69, 0.25);
            text-align: center;
            max-width: 500px;
            width: 90%;
            animation: modalBounce 0.5s ease;
        `;
        
        modalContent.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
            <div style="font-size: 1.125rem; color: #212045; margin-bottom: 2rem; line-height: 1.5;">${message}</div>
            <button class="btn btn-primary" style="min-width: 120px; background: linear-gradient(135deg, #2E5652 0%, #3a6b66 100%);">OK</button>
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
            this.triggerResize();
        });
    },

    showSuccessModal(title, message, callback = null) {
        const modal = document.createElement('div');
        modal.className = 'success-modal-custom';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(33, 32, 69, 0.9) 0%, rgba(46, 86, 82, 0.9) 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
            backdrop-filter: blur(10px);
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 3rem;
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(33, 32, 69, 0.25);
            text-align: center;
            max-width: 500px;
            width: 90%;
            animation: modalBounce 0.5s ease;
        `;
        
        modalContent.innerHTML = `
            <div style="font-size: 4rem; margin-bottom: 1rem; color: #2E5652;">✓</div>
            <h2 style="color: #212045; margin-bottom: 1rem;">${title}</h2>
            <p style="font-size: 1.125rem; color: #2E5652; margin-bottom: 2rem; line-height: 1.5;">${message}</p>
            <button class="btn btn-primary" style="min-width: 120px; background: linear-gradient(135deg, #2E5652 0%, #3a6b66 100%); color: white; padding: 0.875rem 2rem; border-radius: 12px; border: none; font-weight: 600; cursor: pointer;">OK</button>
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
        const closeModal = () => {
            modal.remove();
            style.remove();
            if (callback) callback();
            this.triggerResize();
        };
        
        modalContent.querySelector('button').addEventListener('click', closeModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
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

// Canvas to Base64 with cropping
    canvasToBase64(canvas) {
        // Get the canvas context
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Find the bounds of the signature (non-white pixels)
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = 0;
        let maxY = 0;
        
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const index = (y * canvas.width + x) * 4;
                // Check if pixel is not white (allowing for some tolerance)
                if (data[index] < 250 || data[index + 1] < 250 || data[index + 2] < 250 || data[index + 3] > 5) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        // If no signature found, return empty string
        if (minX > maxX || minY > maxY) {
            return '';
        }
        
        // Add some padding around the signature
        const padding = 10;
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(canvas.width - 1, maxX + padding);
        maxY = Math.min(canvas.height - 1, maxY + padding);
        
        // Create a new canvas with just the signature
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = width;
        croppedCanvas.height = height;
        const croppedCtx = croppedCanvas.getContext('2d');
        
        // Copy the signature area to the new canvas
        croppedCtx.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
        
        // Convert to base64 (this returns the full data URL)
        const dataUrl = croppedCanvas.toDataURL('image/png');
        
        // Remove the data URL prefix to get just the base64 string
        // This removes "data:image/png;base64," from the beginning
        return dataUrl.replace(/^data:image\/png;base64,/, '');
    },
        
    // Trigger resize event for scaling
    triggerResize() {
        // Trigger the fitToIframe function if it exists
        if (window.fitToIframe) {
            setTimeout(() => {
                window.fitToIframe();
            }, 100);
        }
    },

    // Find best matching lender from CSV

    findBestMatchingLender(lenderName) {
        let bestMatch = { similarity: 0, lender: null };
        
        AppState.lendersList.forEach(lender => {
            // Get all possible names to check
            const namesToCheck = [];
            
            // 1. Always include the main name
            if (lender.name) {
                namesToCheck.push(lender.name);
            }
            
            // 2. Add matching_names variations if present
            if (lender.matching_names) {
                const variants = lender.matching_names.split(',').map(v => v.trim()).filter(v => v);
                namesToCheck.push(...variants);
            }
            
            // Check each name variant
            for (const checkName of namesToCheck) {
                // 1. EXACT MATCH - highest priority
                if (lenderName.toLowerCase() === checkName.toLowerCase()) {
                    bestMatch = { similarity: 1.0, lender };
                    return; // Exit forEach early
                }
                
                // 2. SUBSTRING MATCH - second priority
                if (lenderName.toLowerCase().includes(checkName.toLowerCase()) || 
                    checkName.toLowerCase().includes(lenderName.toLowerCase())) {
                    const similarity = 0.9;
                    if (similarity > bestMatch.similarity) {
                        bestMatch = { similarity, lender };
                    }
                } else {
                    // 3. FUZZY MATCH - fallback
                    const similarity = this.similarity(lenderName.toLowerCase(), checkName.toLowerCase());
                    if (similarity > bestMatch.similarity) {
                        bestMatch = { similarity, lender };
                    }
                }
            }
        });
        
        // Threshold 0.8 - return lender WITH similarity score
        if (bestMatch.similarity >= 0.8) {
            return { ...bestMatch.lender, similarity: bestMatch.similarity };
        }
        return null;
    }
};




// --- Form Validation ----------------------------------------------------------------------------------------------------------
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

        // Track email field interaction
        if (email) {
            VisitorTracking.trackDetailedEvent('field_interaction_detail', {
                field: 'email',
                value_provided: true
            });
        }        

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

// --- Step Navigation ----------------------------------------------------------------------------------------------------------

// === Marketing Preferences - Only one tick allowed ===

const marketingYes = document.getElementById("marketing_yes");
const marketingNo = document.getElementById("marketing_no");

if (marketingYes && marketingNo) {
    [marketingYes, marketingNo].forEach(el => {
        el.addEventListener("change", () => {
            if (el.checked) {
                if (el === marketingYes) {
                    marketingNo.checked = false;
                    AppState.mammothPromotionsConsent = 'yes';
                } else {
                    marketingYes.checked = false;
                    AppState.mammothPromotionsConsent = 'no';
                }
                // ADDED: Trigger tracking consent when user makes marketing choice
                CookieConsent.setConsent(true);
            }
        });
    });
    marketingYes.checked = false;
    marketingNo.checked = false;
}

// === Existing Representation - Only one tick allowed ===
const existingYes = document.getElementById("existing_rep_yes");
const existingNo = document.getElementById("existing_rep_no");

if (existingYes && existingNo) {
    [existingYes, existingNo].forEach(el => {
        el.addEventListener("change", () => {
            if (el.checked) {
                if (el === existingYes) existingNo.checked = false;
                else existingYes.checked = false;
            }
        });
    });
    existingYes.checked = false;
    existingNo.checked = false;
}


const Navigation = {

    showStep(stepId) {
        console.log('Attempting to show step:', stepId);
        
        // Hide all steps
        const steps = document.querySelectorAll('.form-step');
        console.log('Found', steps.length, 'form steps');
        steps.forEach(step => {
            step.style.display = 'none';
        });

        // Show the selected step
        const stepElement = document.getElementById(stepId);
        if (stepElement) {
            stepElement.style.display = 'block';
            AppState.currentStep = stepId;
            this.updateProgressBar(stepId);
            console.log('Showing step element:', stepId);
            
            // Reset to substep 1a when showing step 1
            if (stepId === 'step1' && typeof showSubstep === 'function') {
                setTimeout(() => showSubstep('1a'), 50);
            }
            
            // Save form data before changing steps (except step0)
            if (AppState.currentStep !== 'step0' && AppState.currentStep !== stepId) {
                if (typeof this.saveFormData === 'function') {
                    this.saveFormData();
                }
            }
            
            // Track step change
            if (window.VisitorTracking) {
                try {
                    // Track form events based on step
                    if (stepId === 'step1') {
                        VisitorTracking.trackFormEvent('start', 'step1');
                    } else if (stepId !== 'step0') {
                        VisitorTracking.trackFormEvent('progress', stepId);
                    }
                } catch (err) {
                    console.error('VisitorTracking error:', err);
                }
            }
            
            // NEW: Populate form fields after showing the step
            setTimeout(() => {
                if (typeof this.populateFormFields === 'function') {
                    this.populateFormFields();
                }
            }, 100); // Small delay to ensure DOM is ready
            
            // NEW: Sync visitor data to backend AFTER saving
            if (typeof this.syncVisitorData === 'function') {
                this.syncVisitorData();
            }

            // Scroll to top on all steps - no auto-scrolling down
            window.scrollTo(0, 0);
            
            // === COMMENTED OUT: Auto-scroll past header on mobile ===
            // Uncomment below to restore mobile scroll-past-logo behavior
            /*
            if (stepId === 'step0') {
                window.scrollTo(0, 0);
            } else {
                window.scrollTo(0, 0);
                
                if (window.innerWidth <= 768) {
                    setTimeout(() => {
                        const firstContent = stepElement.querySelector('.form-card, .form-section, .step-content, .container');
                        if (firstContent) {
                            if (typeof scrollToElement === 'function') {
                                scrollToElement(firstContent, -20);
                            } else {
                                const yOffset = -20;
                                const y = firstContent.getBoundingClientRect().top + window.pageYOffset + yOffset;
                                window.scrollTo({
                                    top: y,
                                    behavior: 'smooth'
                                });
                            }
                        } else {
                            const header = document.querySelector('.header, .nav-header, .logo-section, .progress-container');
                            if (header) {
                                const headerBottom = header.getBoundingClientRect().bottom;
                                window.scrollTo({
                                    top: headerBottom + window.pageYOffset + 20,
                                    behavior: 'smooth'
                                });
                            } else {
                                window.scrollTo({
                                    top: 150,
                                    behavior: 'smooth'
                                });
                            }
                        }
                    }, 500);
                }
            }
            */
            // === END COMMENTED OUT SECTION ===

        } else {
            console.error(`Step element not found: ${stepId}`);
        }
    },

    updateProgressBar(currentStepId, substep = null) {
        // Progress percentages:
        // 1a: 10%, 1b: 20%, 1c: 30%
        // step2: 40%, step3: 50%, step4: 70%, step5: 90%, step6: 100%
        
        let percent = 0;
        
        if (currentStepId === 'step0') {
            percent = 0;
        } else if (currentStepId === 'step1') {
            // Use substep if provided, otherwise use currentSubstep global
            const sub = substep || (typeof currentSubstep !== 'undefined' ? currentSubstep : '1a');
            if (sub === '1a') percent = 0;
            else if (sub === '1b') percent = 20;
            else if (sub === '1c') percent = 40;
        } else if (currentStepId === 'step2') {
            percent = 60;
        } else if (currentStepId === 'step3') {
            percent = 70;
        } else if (currentStepId === 'step4') {
            percent = 80;
        } else if (currentStepId === 'step5') {
            percent = 90;
        } else if (currentStepId === 'step6') {
            percent = 95;
        }
        
        const progressFill = document.getElementById('progress_fill');
        const progressPercent = document.getElementById('progress_percent');
        const progressContainer = document.getElementById('main_progress_bar');
        
        if (progressContainer) {
            if (currentStepId === 'step0') {
                progressContainer.classList.remove('visible');
            } else {
                // Show container first at 0%, then animate to target
                if (!progressContainer.classList.contains('visible')) {
                    // First time showing - start at 0%
                    if (progressFill) progressFill.style.width = '0%';
                    if (progressPercent) progressPercent.textContent = '0%';
                    progressContainer.classList.add('visible');
                    
                    // Animate to target after brief delay
                    setTimeout(() => {
                        if (progressFill) progressFill.style.width = percent + '%';
                        if (progressPercent) progressPercent.textContent = percent + '%';
                    }, 100);
                } else {
                    // Already visible - just update
                    if (progressFill) progressFill.style.width = percent + '%';
                    if (progressPercent) progressPercent.textContent = percent + '%';
                }
            }
        }
    },

    saveFormData() {
        // CRITICAL: Remove any non-form fields that might have leaked in
        const metadataFields = ['session_id', 'visitor_id', 'resume_token', 'form_progress_percent', 
                            'last_saved_step', 'form_data_snapshot', 'created_at', 'last_activity',
                            'building_number', 'building_name', 'flat', 'street', 'district', 
                            'post_town', 'county', 'post_code'];
        metadataFields.forEach(field => {
            if (field in AppState.formData) {
                console.warn(`Removing metadata field from formData: ${field}`);
                delete AppState.formData[field];
            }
        });
        
        // Save all form fields to AppState (including textarea)
        const inputs = document.querySelectorAll('input, select, textarea');
        console.log('[DOB DEBUG] Saving form data, found', inputs.length, 'inputs');
        
        // Specifically check for DOB fields
        const dobDay = document.getElementById('dob_day');
        const dobMonth = document.getElementById('dob_month');
        const dobYear = document.getElementById('dob_year');
        
        console.log('[DOB DEBUG] DOB field values:');
        console.log('  dob_day:', dobDay ? dobDay.value : 'field not found');
        console.log('  dob_month:', dobMonth ? dobMonth.value : 'field not found');
        console.log('  dob_year:', dobYear ? dobYear.value : 'field not found');
        
        inputs.forEach(input => {
            if (input.id && input.value) {
                // ONLY save actual form field IDs, not address fields (they go in AppState.addresses)
                const addressFields = ['building_number', 'building_name', 'flat', 'street', 
                                    'district', 'county', 'post_town', 'post_code'];
                const isAddressField = addressFields.some(field => input.id.includes(field));
                
                if (!isAddressField) {
                    AppState.formData[input.id] = input.value;
                    // Log DOB fields specifically
                    if (input.id.startsWith('dob_')) {
                        console.log(`[DOB DEBUG] Saved ${input.id} = ${input.value}`);
                    }
                }
            }
        });
        
        // Double-check what's in AppState after saving
        console.log('[DOB DEBUG] AppState.formData DOB fields after save:');
        console.log('  dob_day:', AppState.formData.dob_day);
        console.log('  dob_month:', AppState.formData.dob_month);
        console.log('  dob_year:', AppState.formData.dob_year);
        
        // Specifically ensure mobile is saved
        const mobileInput = document.getElementById('mobile');
        if (mobileInput && mobileInput.value) {
            AppState.formData.mobile = mobileInput.value;
        }
        
        // Save current address (separate from formData)
        AppState.addresses.current = {
            building_number: document.getElementById('building_number')?.value || '',
            building_name: document.getElementById('building_name')?.value || '',
            flat: document.getElementById('flat')?.value || '',
            street: document.getElementById('street')?.value || '',
            district: document.getElementById('district')?.value || '',
            county: document.getElementById('county')?.value || '',
            post_town: document.getElementById('post_town')?.value || '',
            post_code: document.getElementById('post_code')?.value || ''
        };
        
        // Save previous addresses
        if (AppState.previousAddressCount > 0) {
            AppState.addresses.previous1 = {
                building_number: document.getElementById('building_number_prev1')?.value || '',
                building_name: document.getElementById('building_name_prev1')?.value || '',
                flat: document.getElementById('flat_prev1')?.value || '',
                street: document.getElementById('street_prev1')?.value || '',
                district: document.getElementById('district_prev1')?.value || '',
                county: document.getElementById('county_prev1')?.value || '',
                post_town: document.getElementById('post_town_prev1')?.value || '',
                post_code: document.getElementById('post_code_prev1')?.value || ''
            };
        }
        
        if (AppState.previousAddressCount > 1) {
            AppState.addresses.previous2 = {
                building_number: document.getElementById('building_number_prev2')?.value || '',
                building_name: document.getElementById('building_name_prev2')?.value || '',
                flat: document.getElementById('flat_prev2')?.value || '',
                street: document.getElementById('street_prev2')?.value || '',
                district: document.getElementById('district_prev2')?.value || '',
                county: document.getElementById('county_prev2')?.value || '',
                post_town: document.getElementById('post_town_prev2')?.value || '',
                post_code: document.getElementById('post_code_prev2')?.value || ''
            };
        }
        
        console.log('Form data saved:', AppState.formData);
        console.log('Addresses saved:', AppState.addresses);

        // NEW: sync to tracking backend if available
        if (typeof this.syncVisitorData === 'function') {
            this.syncVisitorData();
        }
    },

    // NEW: Populate form fields from AppState.formData
    populateFormFields() {
        const formData = AppState.formData || {};
        console.log('Populating form fields from AppState:', formData);
        
        // Personal fields
        if (document.getElementById('first_name') && formData.first_name) {
            document.getElementById('first_name').value = formData.first_name;
        }
        if (document.getElementById('last_name') && formData.last_name) {
            document.getElementById('last_name').value = formData.last_name;
        }
        if (document.getElementById('email') && formData.email) {
            document.getElementById('email').value = formData.email;
        }
        if (document.getElementById('mobile') && formData.mobile) {
            document.getElementById('mobile').value = formData.mobile;
        }
        if (document.getElementById('title') && formData.title) {
            document.getElementById('title').value = formData.title;
        }
        
        // DOB fields
        if (document.getElementById('dob_day') && formData.dob_day) {
            document.getElementById('dob_day').value = formData.dob_day;
        }
        if (document.getElementById('dob_month') && formData.dob_month) {
            document.getElementById('dob_month').value = formData.dob_month;
        }
        if (document.getElementById('dob_year') && formData.dob_year) {
            document.getElementById('dob_year').value = formData.dob_year;
        }
        
        // Address fields from AppState.addresses
        const currentAddress = AppState.addresses?.current || {};
        if (document.getElementById('building_number') && currentAddress.building_number) {
            document.getElementById('building_number').value = currentAddress.building_number;
        }
        if (document.getElementById('building_name') && currentAddress.building_name) {
            document.getElementById('building_name').value = currentAddress.building_name;
        }
        if (document.getElementById('flat') && currentAddress.flat) {
            document.getElementById('flat').value = currentAddress.flat;
        }
        if (document.getElementById('street') && currentAddress.street) {
            document.getElementById('street').value = currentAddress.street;
        }
        if (document.getElementById('district') && currentAddress.district) {
            document.getElementById('district').value = currentAddress.district;
        }
        if (document.getElementById('post_town') && currentAddress.post_town) {
            document.getElementById('post_town').value = currentAddress.post_town;
        }
        if (document.getElementById('county') && currentAddress.county) {
            document.getElementById('county').value = currentAddress.county;
        }
        if (document.getElementById('post_code') && currentAddress.post_code) {
            document.getElementById('post_code').value = currentAddress.post_code;
        }
        
        // Previous addresses if on that step
        if (AppState.previousAddressCount > 0) {
            const prev1 = AppState.addresses?.previous1 || {};
            if (document.getElementById('building_number_prev1')) {
                document.getElementById('building_number_prev1').value = prev1.building_number || '';
                document.getElementById('street_prev1').value = prev1.street || '';
                document.getElementById('post_town_prev1').value = prev1.post_town || '';
                document.getElementById('post_code_prev1').value = prev1.post_code || '';
            }
        }
        
        if (AppState.previousAddressCount > 1) {
            const prev2 = AppState.addresses?.previous2 || {};
            if (document.getElementById('building_number_prev2')) {
                document.getElementById('building_number_prev2').value = prev2.building_number || '';
                document.getElementById('street_prev2').value = prev2.street || '';
                document.getElementById('post_town_prev2').value = prev2.post_town || '';
                document.getElementById('post_code_prev2').value = prev2.post_code || '';
            }
        }
        
        console.log('Form fields populated');
    },


    // Resume an existing session by token
    async resumeSession(token) {
        if (!token) {
            console.error('No token provided for resume');
            return false;
        }
        
        console.log('Resuming session with token:', token);
        
        try {
            // Fetch session data
            const response = await fetch('/api/resume-session/' + token);
            if (!response.ok) {
                throw new Error('Session not found');
            }
            
            const sessionData = await response.json();
            console.log('Found session:', sessionData.session_id);
            
            // Store session identifiers
            sessionStorage.setItem('session_id', sessionData.session_id);
            sessionStorage.setItem('resume_token', token);
            
            // Clear and set ONLY form fields in AppState.formData
            AppState.formData = {};
            
            // Set personal fields
            if (sessionData.first_name) AppState.formData.first_name = sessionData.first_name;
            if (sessionData.last_name) AppState.formData.last_name = sessionData.last_name;
            if (sessionData.email) AppState.formData.email = sessionData.email;
            if (sessionData.mobile) AppState.formData.mobile = sessionData.mobile;
            if (sessionData.title) AppState.formData.title = sessionData.title;
            
            // Set DOB fields
            if (sessionData.date_of_birth) {
                const dob = new Date(sessionData.date_of_birth);
                AppState.formData.dob_day = dob.getDate().toString();
                AppState.formData.dob_month = (dob.getMonth() + 1).toString();
                AppState.formData.dob_year = dob.getFullYear().toString();
            }
            
            // Set addresses separately
            AppState.addresses = {
                current: {
                    building_number: sessionData.building_number || '',
                    building_name: sessionData.building_name || '',
                    flat: sessionData.flat || '',
                    street: sessionData.street || '',
                    district: sessionData.district || '',
                    post_town: sessionData.post_town || '',
                    county: sessionData.county || '',
                    post_code: sessionData.post_code || ''
                },
                previous1: {},
                previous2: {}
            };
            
            // Parse previous addresses if available
            if (sessionData.previous_addresses) {
                try {
                    const prevAddr = JSON.parse(sessionData.previous_addresses);
                    if (prevAddr.previous1) AppState.addresses.previous1 = prevAddr.previous1;
                    if (prevAddr.previous2) AppState.addresses.previous2 = prevAddr.previous2;
                } catch (e) {
                    console.log('Could not parse previous addresses');
                }
            }
            
            console.log('Session resumed successfully');
            
            // Navigate to saved step
            const step = sessionData.last_saved_step || 'step1';
            this.showStep(step);
            
            return true;
            
        } catch (error) {
            console.error('Failed to resume session:', error);
            return false;
        }
    },

    // NEW: progressive sync of visitor data into /tracking/update-visitor-data
    
    syncVisitorData(generateToken = false) {
        try {
            // ADD THIS SAFETY CHECK - Remove any metadata that shouldn't be in formData
            const metadataFields = ['session_id', 'visitor_id', 'resume_token', 'form_progress_percent', 
                                'last_saved_step', 'form_data_snapshot', 'created_at', 'last_activity',
                                'building_number', 'street', 'post_town', 'post_code'];
            metadataFields.forEach(field => {
                if (field in AppState.formData) {
                    console.warn(`Removing metadata field from formData: ${field}`);
                    delete AppState.formData[field];
                }
            });

            // FIXED: Get session and visitor IDs from sessionStorage instead of VisitorTracking
            const sessionId = sessionStorage.getItem('session_id');

            // Get visitor ID from cookie without helper function
            const visitorIdCookie = document.cookie.split('; ').find(row => row.startsWith('visitor_id='));
            const visitorId = sessionStorage.getItem('visitor_id') || (visitorIdCookie ? visitorIdCookie.split('=')[1] : 'unknown');

            
            if (!sessionId) {
                console.log('No session_id found in sessionStorage, cannot sync visitor data');
                return;
            }

            const formData = AppState.formData || {};
            const addresses = AppState.addresses || {};

            // Calculate form progress
            const stepOrder = ['step0', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6'];
            const currentStepId = AppState.currentStep || '';
            const currentIndex = stepOrder.indexOf(currentStepId);
            const progressPercent = currentIndex >= 0
                ? Math.round((currentIndex / (stepOrder.length - 1)) * 100)
                : 0;

            // Build complete form snapshot including addresses
            const completeFormData = {
                ...formData,
                current_address: addresses.current || {},
                previous_addresses: {
                    previous1: addresses.previous1 || {},
                    previous2: addresses.previous2 || {}
                },
                current_step: currentStepId,
                progress_percent: progressPercent,
                timestamp: new Date().toISOString()
            };

            // Get tracking/attribution data from cookie
            let trackingData = {source: 'direct', medium: 'none', term: '', content: ''};
            try {

                // Get tracking cookie without helper function  
                const trackingCookieMatch = document.cookie.split('; ').find(row => row.startsWith('_belmondpcp_tracking='));
                const trackingCookie = trackingCookieMatch ? decodeURIComponent(trackingCookieMatch.split('=')[1]) : null;

                if (trackingCookie) {
                    trackingData = JSON.parse(decodeURIComponent(trackingCookie));
                }
            } catch (e) {
                console.log('Could not parse tracking cookie');
            }

            // Get URL parameters
            const urlParams = new URLSearchParams(window.location.search);

            // Get current UK time
            const now = new Date();
            const ukDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

            // Store form_started if not already stored
            if (!AppState.form_started) {
                AppState.form_started = new Date().toISOString();
                sessionStorage.setItem('form_started', AppState.form_started);
            }

            // Build payload with ALL fields
            const payload = {
                session_id: sessionId,
                visitor_id: visitorId,
                
                // Personal information
                first_name: formData.first_name || '',
                last_name: formData.last_name || '',
                email: (formData.email || '').trim(),
                mobile: (formData.mobile || '').trim(),
                title: formData.title || '',
                
                // UK TIME FIELDS
                uk_date: now.toISOString().split('T')[0],
                uk_hour: now.getHours(),
                uk_day_of_week: ukDays[now.getDay()],
                
                // ATTRIBUTION FIELDS
                source: trackingData.source || urlParams.get('utm_source') || 'direct',
                medium: trackingData.medium || urlParams.get('utm_medium') || 'none',
                campaign: urlParams.get('utm_campaign') || trackingData.campaign || '',
                term: trackingData.term || urlParams.get('utm_term') || '',
                content: trackingData.content || urlParams.get('utm_content') || '',
                
                // FACEBOOK TRACKING FIELDS
                fb_campaign_id: urlParams.get('campaign_id') || '',
                fb_campaign_name: urlParams.get('campaign_name') || '',
                fb_adset_id: urlParams.get('adset_id') || '',
                fb_adset_name: urlParams.get('adset_name') || '',
                fb_ad_id: urlParams.get('ad_id') || '',
                fb_ad_name: urlParams.get('ad_name') || '',
                fb_placement: urlParams.get('placement') || '',
                fb_platform: urlParams.get('platform') || '',
                
                // GOOGLE TRACKING FIELDS
                gclid: urlParams.get('gclid') || '',
                google_keyword: urlParams.get('keyword') || '',
                google_match_type: urlParams.get('matchtype') || '',
                google_ad_position: urlParams.get('adposition') || '',
                
                // PAGE/DEVICE TRACKING
                landing_page: window.location.pathname,
                referrer: document.referrer || '',
                device_type: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
                browser: navigator.userAgent.substring(0, 255),
                ip_address: '', // This is set server-side
                
                // FORM STATE TRACKING
                form_started: AppState.form_started || sessionStorage.getItem('form_started') || now.toISOString(),
                last_completed_step: AppState.last_completed_step || AppState.currentStep || '',
                last_active_field: AppState.last_active_field || '',
                
                // INTERACTION TRACKING
                total_interactions: AppState.total_interactions || 0,
                tab_visibility_changes: AppState.tab_visibility_changes || 0,
                
                // FCA/CONSENT TRACKING
                fca_disclosure_viewed: AppState.fca_disclosure_viewed || false,
                fca_reason_selected: AppState.fca_reason_selected || '',
                terms_accepted: AppState.terms_accepted || false,
                terms_scrolled_to_bottom: AppState.terms_scrolled_to_bottom || false,
                
                // Form progress
                form_progress_percent: progressPercent,
                last_saved_step: currentStepId,
                
                // Complete form data snapshot (as string)
                form_data_snapshot: JSON.stringify(completeFormData)
            };

            // Professional reps if selected
            if (AppState.professional_reps_selected) {
                payload.professional_reps_selected = JSON.stringify(AppState.professional_reps_selected);
            }

            // Generate resume token if requested or if we have enough data
            if (generateToken || (formData.mobile && progressPercent >= 25)) {
                if (!AppState.resumeToken) {
                    // Generate a 6-character alphanumeric token
                    AppState.resumeToken = Math.random().toString(36).substring(2, 8).toUpperCase();
                }
                payload.resume_token = AppState.resumeToken;
            }

            // Add date of birth
            if (formData.dob_day && formData.dob_month && formData.dob_year) {
                const day = String(formData.dob_day).padStart(2, '0');
                const month = String(formData.dob_month).padStart(2, '0');
                payload.date_of_birth = `${formData.dob_year}-${month}-${day}`;
            }

            // Add current address
            const current = addresses.current || {};
            payload.building_number = current.building_number || '';
            payload.building_name = current.building_name || '';
            payload.flat = current.flat || '';
            payload.street = current.street || '';
            payload.district = current.district || '';
            payload.post_town = current.post_town || '';
            payload.county = current.county || '';
            payload.post_code = current.post_code || '';

            // Add previous addresses
            const previousAddresses = {};
            if (addresses.previous1 && Object.keys(addresses.previous1).length > 0) {
                previousAddresses.previous1 = addresses.previous1;
            }
            if (addresses.previous2 && Object.keys(addresses.previous2).length > 0) {
                previousAddresses.previous2 = addresses.previous2;
            }
            if (Object.keys(previousAddresses).length > 0) {
                payload.previous_addresses = JSON.stringify(previousAddresses);
            }

            // ADDED: Debug log to see what we're sending (ENHANCED)
            console.log('Syncing visitor data with payload:', {
                session_id: payload.session_id,
                first_name: payload.first_name,
                last_name: payload.last_name,
                email: payload.email,
                mobile: payload.mobile,
                uk_date: payload.uk_date,
                source: payload.source,
                medium: payload.medium,
                total_interactions: payload.total_interactions
            });

            // Send to backend
            fetch('/tracking/update-visitor-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(response => response.json())
            .then(data => {
                if (data.updated) {
                    console.log('✅ Visitor data synced successfully', AppState.resumeToken ? 'with resume token: ' + AppState.resumeToken : '');
                } else if (data.error) {
                    console.error('❌ Server error syncing visitor data:', data.error);
                }
            })
            .catch(err => {
                console.error('❌ Failed to sync visitor data:', err);
            });

        } catch (err) {
            console.error('syncVisitorData encountered an error:', err);
        }
    },

   populateReviewSummary() {
        const summary = document.getElementById('review_summary');
        const data = AppState.formData;
        
        // Make sure we have the latest mobile value
        const mobileInput = document.getElementById('mobile');
        if (mobileInput) {
            data.mobile = mobileInput.value;
        }
        
        // Build address strings - NO HTML breaks for proper alignment
        let currentAddressStr = [
            AppState.addresses.current.building_number,
            AppState.addresses.current.building_name,
            AppState.addresses.current.flat,
            AppState.addresses.current.street
        ].filter(Boolean).join(', ');
        
        // Add rest of address on new lines
        let currentAddressParts = [];
        if (currentAddressStr) currentAddressParts.push(currentAddressStr);
        if (AppState.addresses.current.post_town) currentAddressParts.push(AppState.addresses.current.post_town);
        if (AppState.addresses.current.district) currentAddressParts.push(AppState.addresses.current.district);
        if (AppState.addresses.current.county) currentAddressParts.push(AppState.addresses.current.county);
        if (AppState.addresses.current.post_code) currentAddressParts.push(AppState.addresses.current.post_code);
        
        // Join with line breaks for display
        currentAddressStr = currentAddressParts.join('<br>');
        
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
            <div class="review-item address-item">
                <span class="review-label">Address:</span>
                <span class="review-value">${currentAddressStr}</span>
            </div>
        `;
        
        // Add previous addresses if they exist
        if (AppState.previousAddressCount > 0 && AppState.addresses.previous1.post_code) {
            let prev1AddressStr = [
                AppState.addresses.previous1.building_number,
                AppState.addresses.previous1.building_name,
                AppState.addresses.previous1.flat,
                AppState.addresses.previous1.street
            ].filter(Boolean).join(', ');
            
            let prev1AddressParts = [];
            if (prev1AddressStr) prev1AddressParts.push(prev1AddressStr);
            if (AppState.addresses.previous1.post_town) prev1AddressParts.push(AppState.addresses.previous1.post_town);
            if (AppState.addresses.previous1.district) prev1AddressParts.push(AppState.addresses.previous1.district);
            if (AppState.addresses.previous1.county) prev1AddressParts.push(AppState.addresses.previous1.county);
            if (AppState.addresses.previous1.post_code) prev1AddressParts.push(AppState.addresses.previous1.post_code);
            
            prev1AddressStr = prev1AddressParts.join('<br>');
            
            summary.innerHTML += `
                <div class="review-item address-item">
                    <span class="review-label">Previously:</span>
                    <span class="review-value">${prev1AddressStr}</span>
                </div>
            `;
        }
        
        if (AppState.previousAddressCount > 1 && AppState.addresses.previous2.post_code) {
            let prev2AddressStr = [
                AppState.addresses.previous2.building_number,
                AppState.addresses.previous2.building_name,
                AppState.addresses.previous2.flat,
                AppState.addresses.previous2.street
            ].filter(Boolean).join(', ');
            
            let prev2AddressParts = [];
            if (prev2AddressStr) prev2AddressParts.push(prev2AddressStr);
            if (AppState.addresses.previous2.post_town) prev2AddressParts.push(AppState.addresses.previous2.post_town);
            if (AppState.addresses.previous2.district) prev2AddressParts.push(AppState.addresses.previous2.district);
            if (AppState.addresses.previous2.county) prev2AddressParts.push(AppState.addresses.previous2.county);
            if (AppState.addresses.previous2.post_code) prev2AddressParts.push(AppState.addresses.previous2.post_code);
            
            prev2AddressStr = prev2AddressParts.join('<br>');
            
            summary.innerHTML += `
                <div class="review-item address-item">
                    <span class="review-label">Before that:</span>
                    <span class="review-value">${prev2AddressStr}</span>
                </div>
            `;
        }
    }

};





// Make Navigation available globally for iframe scaling
window.Navigation = Navigation;

// --- API Calls ----------------------------------------------------------------------------------------------------------------
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
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Credit report failed');
        }
        
        const result = await response.json();
        
        // Store Valify response for debugging
        AppState.valifyDebugData = result;
        
        // Process summaryReportV2 if present
        if (result.data && result.data.summaryReportV2) {
            console.log('Processing summaryReportV2 format');
            const summaryV2 = result.data.summaryReportV2;
            
            // Transform accounts from summaryReportV2 to match expected format
            if (summaryV2.accounts) {
                result.data.accounts = summaryV2.accounts;
            }
            
            // Also merge any existing summaryReport accounts if present
            if (result.data.summaryReport && result.data.summaryReport.accounts) {
                result.data.accounts = [...(result.data.accounts || []), ...result.data.summaryReport.accounts];
            }
        }
        
        return result;
    },

    async uploadToFLG(data) {
        // Include all tracking fields, signature, and Valifi response in the upload
        const uploadData = {
            ...data,
            signatureBase64: AppState.signatureBase64,
            valifiResponse: AppState.valifiResponse,
            pdfUrl: AppState.pdfUrl || data.pdfUrl,

            // ADD THESE TRACKING FIELDS:
            session_id: window.VisitorTracking ? VisitorTracking.sessionId : null,
            source: data.source || AppState.tracking?.source || 'direct',
            medium: data.medium || AppState.tracking?.medium || 'none',
            term: data.term || AppState.tracking?.term || '',
            campaign: data.campaign || AppState.campaign || 'BelmondPCP',
            
            // Include consent flags (EXISTING)
            motorFinanceConsent: AppState.motorFinanceConsent,
            irresponsibleLendingConsent: AppState.irresponsibleLendingConsent,
            
            // NEW FCA CHOICE CONSENT FIELDS
            belmondChoiceConsent: AppState.belmondChoiceConsent,
            choiceReason: AppState.choiceReason,
            otherReasonText: AppState.otherReasonText || ''
        };
        
        // Log what we're sending for debugging
        console.log('uploadToFLG payload includes tracking:', {
            source: uploadData.source,
            medium: uploadData.medium,
            term: uploadData.term,
            campaign: uploadData.campaign,
            // NEW: Log FCA choice data
            belmondChoice: uploadData.belmondChoiceConsent,
            choiceReason: uploadData.choiceReason,
            otherReason: uploadData.otherReasonText
        });
        
        const response = await fetch('/upload_summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(uploadData)
        });
        
        return response.json();
    },    


    // Fetch terms content - UPDATED WITH NEW CONTENT
    async fetchTermsContent() {
        try {
            // Updated terms content from the Word document
            const termsContent = `
                <h3>Belmond & Co Claims Management Limited "“ Terms & Conditions</h3>
                <p><strong>Effective Date: August 2025</strong></p>
                
                <h3>1. Introduction</h3>
                <p>These Terms and Conditions ("Terms") govern your engagement with Belmond & Co Claims Management Limited ("we", "us", or "our") for the provision of claims management services. By signing these Terms or otherwise instructing us to act, you agree to be bound by them.</p>
                <p>We are authorised and regulated by the Financial Conduct Authority (FCA) for claims management activities FRN 838551.</p>
                
                <h3>2. Scope of Services</h3>
                <p>We provide claims management services to assist you in pursuing compensation where you may have been mis-sold or unfairly provided with a vehicle finance agreement. Our services include:</p>
                <ul>
                    <li>Reviewing your vehicle finance agreements.</li>
                    <li>Assessing the viability of potential claims.</li>
                    <li>Investigating commission non-disclosure (including Discretionary Commission Arrangements).</li>
                    <li>Investigating Irresponsible Lending / Affordability where you give explicit consent.</li>
                    <li>Submitting claims to lenders on your behalf.</li>
                    <li>Managing all correspondence with lenders.</li>
                    <li>Negotiating settlements where applicable.</li>
                </ul>
                
                <h3>3. Authority to Act</h3>
                
                <h4>3.1 General Authority</h4>
                <p>By signing these Terms, you appoint us as your representative to pursue your claim(s) and to liaise with your lender(s) and other relevant parties. You agree not to appoint another claims management company or solicitor to pursue the same claim.</p>
                
                <h4>3.2 Authority in the Event of an FCA Scheme</h4>
                <p><strong>If the FCA introduces a statutory redress scheme:</strong></p>
                <ul>
                    <li><strong>You may be automatically included in that scheme unless you actively opt out.</strong></li>
                    <li><strong>By signing these Terms, you give us explicit consent to act on your behalf within such a scheme where representatives are permitted.</strong></li>
                    <li><strong>If you opt out of the FCA scheme, you give us explicit authority to continue pursuing your claim independently.</strong></li>
                </ul>
                
                <h4>3.3 Irresponsible Lending / Affordability Claims</h4>
                <p>In addition to commission non-disclosure claims, you may also have a claim if your lender failed to properly assess affordability. This is a separate service and requires your explicit opt-in consent.</p>
                
                <h3>4. Fees</h3>
                
                <h4>4.1 How Our Fees Work</h4>
                <ul>
                <li>We only charge a fee if your claim results in compensation.</li>
                <li>
                    If your claim is successful, our success fee is paid by you in one of two ways.
                    You will receive the compensation directly from the lender and you pay Belmond's success fee from those proceeds,
                    or if we receive the compensation in our client account, our success fee will be deducted from the compensation we
                    recover for you before you receive your payment.
                </li>
                <li>
                    Our success fee typically ranges from 18% to 36% (including VAT) depending on the amount of redress and
                    the complexity of your claim.
                </li>
                <li>If your claim does not result in compensation, you will not be charged any fee.</li>
                </ul>
                <p><strong>Important:</strong> You are not required to use Belmond &amp; Co Claims Management Limited to pursue your claim.
                You can make a claim yourself directly to your lender or the Financial Ombudsman Service without paying our fee.</p>
                <p>Our success fees are shown below. See Section&nbsp;4.2 for worked examples showing how these are applied.</p>
                
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <thead>
                        <tr style="background: #1A1A47; color: white;">
                            <th colspan="2" style="padding: 12px; text-align: center; font-size: 14px; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.2);">REDRESS VALUE RANGE</th>
                            <th colspan="2" style="padding: 12px; text-align: center; font-size: 14px; font-weight: 600;">TOTAL FEE INCLUDING VAT</th>
                        </tr>
                        <tr style="background: #2E5652; color: white;">
                            <th style="padding: 10px; text-align: center; font-size: 13px; border-right: 1px solid rgba(255,255,255,0.2);">Lower (£)</th>
                            <th style="padding: 10px; text-align: center; font-size: 13px; border-right: 1px solid rgba(255,255,255,0.2);">Upper (£)</th>
                            <th style="padding: 10px; text-align: center; font-size: 13px; border-right: 1px solid rgba(255,255,255,0.2);">%</th>
                            <th style="padding: 10px; text-align: center; font-size: 13px;">MAX FEE<br>INCLUDING VAT</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="background: white;">
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£1</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£1,499</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">36.0%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£540</td>
                        </tr>
                        <tr style="background: #f8f9fa;">
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£1,500</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£9,999</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">33.6%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£3,360</td>
                        </tr>
                        <tr style="background: white;">
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£10,000</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£24,999</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">30.0%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£7,500</td>
                        </tr>
                        <tr style="background: #f8f9fa;">
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£25,000</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£49,999</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">24.0%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£12,000</td>
                        </tr>
                        <tr style="background: white;">
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">£50,000</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">n/a</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">18.0%</td>
                            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">-</td>
                        </tr>
                    </tbody>
                </table>
                
                <h4>4.2 Worked Examples (Including VAT)</h4>
                <ul>
                    <li>If you receive £1,000 in compensation, our fee at 36% would be £300 (including VAT). You would receive £700.</li>
                    <li>If you receive £2,500 in compensation, our fee at 33.6% would be £840 (including VAT). You would receive £1,660.</li>
                    <li>If you receive £10,000 in compensation, our fee at 30% would be £3,000 (including VAT). You would receive £7,000.</li>
                </ul>
                
                <h4>4.3 Client Money & Redress Payments</h4>
                <p>Belmond Claims Limited is authorised under the FCA's CASS 13 rules to handle client money.</p>
                <ul>
                    <li>If a lender pays redress directly to us, the funds will be received into a segregated client account.</li>
                    <li>We will deduct our agreed fee in accordance with these Terms and promptly transfer the balance to you.</li>
                    <li>All client money is safeguarded and managed in line with the FCA's client money requirements.</li>
                </ul>
                <p>Where possible, lenders may pay redress directly to you. In this case, we will invoice you for our fee after you receive your compensation.</p>
                
                <h3>5. Your Responsibilities</h3>
                <p>You agree to:</p>
                <ul>
                    <li>Provide accurate and complete information.</li>
                    <li>Respond promptly to requests for documents or clarification.</li>
                    <li>Notify us of any changes to your contact details.</li>
                    <li>Not pursue the same claim through another party.</li>
                    <li>Co-operate fully during the process.</li>
                </ul>
                
                <h3>6. Data Protection & Privacy</h3>
                <p>We process your personal data in accordance with the UK GDPR and the Data Protection Act 2018.</p>
                
                <h4>6.1 Use of Credit Reference Data (Valifi / Equifax)</h4>
                <p>To identify historic motor finance agreements, we may use a third-party provider, Valifi Limited, who access data from Equifax/Transunion. This involves performing a soft credit search on your credit file.</p>
                <ul>
                    <li>This search is used solely to identify motor finance agreements that may give rise to a potential claim.</li>
                    <li>It will not affect your credit score and will not be visible to lenders for credit assessment purposes.</li>
                    <li>By signing these Terms, you give us consent to share your personal details with Valifi for this purpose.</li>
                    <li>We do not use this information for any purpose other than pursuing your claim.</li>
                </ul>
                
                <h4>6.2 General Data Processing</h4>
                <p>Your personal data will only be shared with third parties where necessary to progress your claim or where required by law. Our full Privacy Policy is available on our website.</p>
                
                <h3>7. Cancellation Rights</h3>
                <ul>
                    <li>You have the right to cancel this agreement <strong>within 14 days</strong> of signing with no charge.</li>
                    <li>If you cancel <strong>after 14 days</strong>, you may be liable for reasonable costs incurred in progressing your claim up to the point of cancellation.</li>
                    <li>To cancel, you must notify us in writing by email or post.</li>
                </ul>
                
                <h3>8. Limitation of Liability</h3>
                <ul>
                    <li>We are not liable for indirect or consequential losses.</li>
                    <li>Our liability is limited to the fees actually paid by you.</li>
                    <li>We are not responsible for lenders' decisions on claims.</li>
                </ul>
                
                <h3>9. Complaints Procedure</h3>
                <ul>
                    <li>Please contact us in the first instance if you are dissatisfied.</li>
                    <li>Unresolved complaints may be escalated to our Complaints Manager.</li>
                    <li>You have the right to refer complaints to the Financial Ombudsman Service.</li>
                </ul>
                
                <h3>10. Governing Law and Jurisdiction</h3>
                <p>These Terms are governed by the laws of England and Wales.</p>
                <p>If you live in Scotland or Northern Ireland, you may also bring legal proceedings in your local courts.</p>
                
                <h3>11. Contact Details</h3>
                <p>Belmond & Co Claims Management Limited<br>
                Baird House, Scotswood Road, Newcastle upon Tyne, NE4 7DF<br>
                Email: claim@belmondclaims.com<br>
                Phone: 0330 094 8438<br>
                Hours: Monday to Friday, 9am "“ 6pm</p>
                
                <h3>12. Updates to Terms</h3>
                <p>We may update these Terms from time to time. Any changes will be communicated via email or our website. Continued use of our Service after notification constitutes acceptance of the updated Terms.</p>
            `;
            
            return termsContent;
        } catch (error) {
            console.error('Failed to fetch terms:', error);
            throw error;
        }
    }
};

// --- Event Handlers -----------------------------------------------------------------------------------------------------------
const EventHandlers = {
    // Initialize all event handlers
    init() {
        console.log('EventHandlers.init() called');

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

        // Load professional representatives on init
        this.loadProfessionalRepresentatives();

    },

    // FIXED: Mobile responsive handler with proper stepId reference
    initMobileResponsive() {
        // Fix progress bar on resize
        window.addEventListener('resize', () => {
            const progressBar = document.getElementById('main_progress_bar');
            if (progressBar) {
                // Use AppState.currentStep instead of undefined stepId
                if (AppState.currentStep === 'step0') {
                    progressBar.style.cssText = 'display: none !important;';
                } else {
                    // Again, let the CSS handle layout; we only enforce "shown"
                    progressBar.style.cssText = '';
                }
            }
        });
    },

    
    // In EventHandlers.loadLenders()
    async loadLenders() {
        try {
            const res = await fetch('/lenders', { credentials: 'include' });
            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data?.lenders ?? []);

            // ðŸ”§ Normalize: guarantee .name exists and is trimmed
            AppState.lendersList = arr
            .map(l => ({
                ...l,
                name: (l.name || l.display_name || l.flg_lender_name || l.flg_name || '').trim(),
            }))
            .filter(l => l.name); // drop empties

            // keep it nice to browse
            AppState.lendersList.sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
            console.error('Failed to load lenders:', err);
            AppState.lendersList = [];
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
            highlightButton('start_journey');  // Highlight on page load
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
        
        // Populate year dropdown
        const yearSelect = document.getElementById('dob_year');
        const dobCurrentYear = new Date().getFullYear();
        const dobMaxYear = dobCurrentYear - 18; // Must be 18+ (so 2007 if current year is 2025)
        const dobMinYear = 1900;
        
        // Start from 2007 (dobMaxYear) and go down to 1900
        for (let year = dobMaxYear; year >= dobMinYear; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        }

        // Title dropdown - add change listener to clear error AND validate
        document.getElementById('title').addEventListener('change', () => {
            Utils.clearError('title_error');
            validateStep1();  // Check if button should show
        });
        
        // ADD VALIDATION LISTENERS TO ALL REQUIRED FIELDS
        document.getElementById('first_name').addEventListener('input', () => {
            Utils.clearError('first_name_error');
            validateStep1();
        });
        
        document.getElementById('last_name').addEventListener('input', () => {
            Utils.clearError('last_name_error');
            validateStep1();
        });
        
        document.getElementById('dob_day').addEventListener('change', () => {
            Utils.clearError('dob_error');
            validateStep1();
        });
        
        document.getElementById('dob_month').addEventListener('change', () => {
            Utils.clearError('dob_error');
            validateStep1();
        });
        
        document.getElementById('dob_year').addEventListener('change', () => {
            Utils.clearError('dob_error');
            validateStep1();
        });
        
        document.getElementById('email').addEventListener('input', () => {
            Utils.clearError('email_error');
            validateStep1();
        });
        
        // Optional: Add validation for middle name if you want (not required)
        document.getElementById('middle_name').addEventListener('input', () => {
            Utils.clearError('middle_name_error');
            // Don't call validateStep1 since middle name is optional
        });
        


        // === SUBSTEP 1A: First Name and Last Name - Auto advance on Enter ===
        document.getElementById('first_name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const lastName = document.getElementById('last_name');
                if (lastName && !lastName.value.trim()) {
                    lastName.focus();
                } else {
                    advanceSubstep();
                }
            }
        });
        
        document.getElementById('last_name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                advanceSubstep();
            }
        });
        
        // Also advance when last_name loses focus if both fields are filled
        document.getElementById('last_name').addEventListener('blur', () => {
            const firstName = document.getElementById('first_name')?.value?.trim() || '';
            const lastName = document.getElementById('last_name')?.value?.trim() || '';
            if (firstName && lastName && currentSubstep === '1a') {
                // Small delay to allow for tab navigation
                setTimeout(() => {
                    if (currentSubstep === '1a') {
                        advanceSubstep();
                    }
                }, 300);
            }
        });
        
        // === SUBSTEP 1B: DOB - Auto advance when all selected ===
        ['dob_day', 'dob_month', 'dob_year'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                const day = document.getElementById('dob_day')?.value || '';
                const month = document.getElementById('dob_month')?.value || '';
                const year = document.getElementById('dob_year')?.value || '';
                
                if (day && month && year && currentSubstep === '1b') {
                    setTimeout(() => advanceSubstep(), 200);
                }
                validateStep1();
            });
        });
        
        // === SUBSTEP 1C: Email - Auto advance on Enter ===
        document.getElementById('email').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                advanceSubstep();
            }
        });

        // Also validate on email input to enable Continue button
        document.getElementById('email').addEventListener('input', () => {
            validateStep1();
        });

        
        // === Back button for substeps ===
        document.getElementById('back_substep')?.addEventListener('click', () => {
            goBackSubstep();
        });
        
        // Initialize on substep 1a
        showSubstep('1a');

        // Clear button
        document.getElementById('clear_step1').addEventListener('click', () => {
            document.getElementById('searchForm').reset();
            AppState.formData = {};
            validateStep1();  // Re-validate after clearing (will hide button)
        });
        
        // Next button
        document.getElementById('next_to_step2').addEventListener('click', () => {
            const firstName = document.getElementById('first_name')?.value?.trim() || '';
            const lastName = document.getElementById('last_name')?.value?.trim() || '';
            const day = document.getElementById('dob_day')?.value || '';
            const month = document.getElementById('dob_month')?.value || '';
            const year = document.getElementById('dob_year')?.value || '';
            const email = document.getElementById('email')?.value?.trim() || '';
            
            const substep1aComplete = !!(firstName && lastName);
            const substep1bComplete = !!(day && month && year);
            const substep1cComplete = !!email;
            
            if (currentSubstep === '1a' && substep1aComplete) {
                // Go to 1b
                showSubstep('1b');
            } else if (currentSubstep === '1b' && substep1aComplete && substep1bComplete) {
                // Go to 1c
                showSubstep('1c');
            } else if (currentSubstep === '1c' && substep1aComplete && substep1bComplete && substep1cComplete) {
                // All complete - go to step 2
                if (FormValidation.validateStep1()) {
                    if (!AppState.formStarted) {
                        AppState.formStarted = true;
                        VisitorTracking.trackFormEvent('start', 'step1');
                    }
                    Navigation.showStep('step2');
                }
            }
        });

        // Initial validation check (button starts hidden, this checks if it should show)
        validateStep1();
        
        // Run validation after initialization (catches restored data)
        setTimeout(() => {
            validateStep1();
        }, 100);
        
        // Also run validation when form might be auto-filled by browser
        setTimeout(() => {
            validateStep1();
        }, 500);
    },

    initStep2() {
        // Toggle manual address entry for current address
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
            Utils.triggerResize();
        });
        
        // Setup address lookup for all address sections
        this.setupAddressLookup('', 'current');
        this.setupAddressLookup('_prev1', 'previous1');
        this.setupAddressLookup('_prev2', 'previous2');
        
        // Add Previous Address button
        const addPrevAddressBtn = document.getElementById('add_prev_address_btn');
        if (addPrevAddressBtn) {
            addPrevAddressBtn.style.display = 'none';  // Hide the button 
            addPrevAddressBtn.addEventListener('click', () => {
                AppState.previousAddressCount++;
                if (AppState.previousAddressCount === 1) {
                    document.getElementById('prev_address_1').style.display = 'block';
                } else if (AppState.previousAddressCount === 2) {
                    document.getElementById('prev_address_2').style.display = 'block';
                    addPrevAddressBtn.style.display = 'none'; // Hide button after 2 addresses
                }
                Utils.triggerResize();
            });
        }
        
        // Navigation buttons
        document.getElementById('back_to_step1').addEventListener('click', () => {
            Navigation.showStep('step1');
            setTimeout(() => showSubstep('1c'), 100);
        });

        // Add validation listeners for manual address entry
        const manualAddressFields = ['building_number', 'street', 'post_town', 'post_code'];
        manualAddressFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', () => {
                    // Update AppState
                    AppState.addresses.current = {
                        building_number: document.getElementById('building_number').value || '',
                        building_name: document.getElementById('building_name').value || '',
                        flat: document.getElementById('flat').value || '',
                        street: document.getElementById('street').value || '',
                        district: document.getElementById('district').value || '',
                        county: document.getElementById('county').value || '',
                        post_town: document.getElementById('post_town').value || '',
                        post_code: document.getElementById('post_code').value || ''
                    };
                    validateStep2();  // Check if button should show
                });
            }
        });

        // Navigation button
        document.getElementById('next_to_step3').addEventListener('click', () => {
            if (FormValidation.validateStep2()) {
                Navigation.showStep('step3');
            }
        });

        // Initial validation check when step 2 loads
        // This will show the button if address already exists (e.g., going back)
        validateStep2();
    },

    setupAddressLookup(suffix, addressType) {
        // Address lookup
        const lookupBtn = document.getElementById('address_lookup' + suffix + '_btn');
        const postcodeInput = document.getElementById('lookup_postcode' + suffix);
        
        // Hide the Find Address button - we auto-trigger on Enter
        if (lookupBtn) {
            lookupBtn.style.display = 'none';
        }
        
        // Create the lookup function to reuse
        const performLookup = async () => {
            let postcode = postcodeInput?.value?.trim();
            
            if (!postcode) {
                Utils.showError('address_error' + suffix, 'Please enter a postcode');
                return;
            }
            
            // Convert postcode to uppercase
            postcode = postcode.toUpperCase();
            postcodeInput.value = postcode;
            
            Utils.showLoading('Looking up addresses...');
            Utils.clearError('address_error' + suffix);
            
            try {
                const data = await API.lookupAddress(postcode);
                const addresses = data.addresses || [];
                
                const addressSelect = document.getElementById('address_select' + suffix);
                addressSelect.innerHTML = '<option value="">Choose from list...</option>';
                
                if (addresses.length === 0) {
                    Utils.showError('address_error' + suffix, 'No addresses found for this postcode');
                    document.getElementById('address_container' + suffix).style.display = 'none';
                } else {
                    // Sort addresses
                    const addressSortKey = (addr) => {
                        let sortKey = '';
                        if (addr.number) {
                            const numMatch = String(addr.number).match(/^(\d+)(.*)$/);
                            if (numMatch) {
                                sortKey = numMatch[1].padStart(4, '0') + (numMatch[2] || '');
                            } else {
                                sortKey = String(addr.number);
                            }
                        }
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
                        const parts = [];
                        if (addr.number) parts.push(addr.number);
                        if (addr.name) {
                            if (!isNaN(addr.name)) {
                                if (addr.number) {
                                    parts.push(`Flat ${addr.name}`);
                                } else {
                                    parts.push(addr.name);
                                }
                            } else {
                                parts.push(addr.name);
                            }
                        }
                        if (addr.subBuilding) {
                            if (!addr.name || isNaN(addr.name)) {
                                parts.push(addr.subBuilding);
                            }
                        }
                        if (addr.flat && !addr.subBuilding && (!addr.name || isNaN(addr.name))) {
                            parts.push(`Flat ${addr.flat}`);
                        }
                        if (addr.street1) parts.push(addr.street1);
                        if (addr.postTown) parts.push(addr.postTown);
                        option.textContent = parts.join(', ');
                        addressSelect.appendChild(option);
                    });
                    
                    document.getElementById('address_container' + suffix).style.display = 'block';
                    Utils.triggerResize();
                }
            } catch (error) {
                console.error('Address lookup error:', error);
                Utils.showError('address_error' + suffix, 'Address lookup failed. Please try again or enter manually.');
                document.getElementById('address_container' + suffix).style.display = 'none';
            } finally {
                Utils.hideLoading();
            }
        };
        
        // Trigger lookup on Enter key (mobile "Go" / desktop "Return")
        if (postcodeInput) {
            // Track if lookup already triggered to prevent duplicates
            let lookupPending = false;
            
            const triggerLookupIfValid = (delay = 0) => {
                if (lookupPending) return;
                const postcode = postcodeInput.value?.trim();
                const addressContainer = document.getElementById('address_container' + suffix);
                if (postcode && postcode.length >= 5 && addressContainer?.style.display !== 'block') {
                    lookupPending = true;
                    setTimeout(() => {
                        performLookup();
                        lookupPending = false;
                    }, delay);
                }
            };
            
            // Enter key (desktop Return / mobile Go)
            postcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    performLookup();
                }
            });
            
            // Input event - fires on typing, paste, autofill, voice input, etc.
            postcodeInput.addEventListener('input', () => {
                triggerLookupIfValid(500);  // Debounce 500ms
            });
            
            // Paste event - backup for input event
            postcodeInput.addEventListener('paste', () => {
                setTimeout(() => triggerLookupIfValid(100), 50);
            });
            
            // Blur - catches keyboard dismiss on mobile
            postcodeInput.addEventListener('blur', () => {
                triggerLookupIfValid(300);
            });
            
            // Change event - catches autofill and some mobile inputs
            postcodeInput.addEventListener('change', () => {
                triggerLookupIfValid(100);
            });
        }
        
        // Keep button click as backup (in case button is shown later)
        if (lookupBtn) {
            lookupBtn.addEventListener('click', performLookup);
        }
        
        // Address selection
        const addressSelect = document.getElementById('address_select' + suffix);
        if (addressSelect) {
            addressSelect.addEventListener('change', (e) => {
                if (!e.target.value) return;
                
                const addr = JSON.parse(e.target.value);
                
                // Populate fields
                document.getElementById('building_number' + suffix).value = addr.number || '';
                if (addr.name && isNaN(addr.name)) {
                    document.getElementById('building_name' + suffix).value = addr.name;
                } else {
                    document.getElementById('building_name' + suffix).value = '';
                }
                
                let flatValue = '';
                if (addr.subBuilding) {
                    flatValue = addr.subBuilding;
                } else if (addr.flat) {
                    flatValue = `Flat ${addr.flat}`;
                } else if (addr.name && !isNaN(addr.name) && addr.number) {
                    flatValue = `Flat ${addr.name}`;
                } else if (addr.house) {
                    flatValue = addr.house;
                }
                
                document.getElementById('flat' + suffix).value = flatValue;
                document.getElementById('street' + suffix).value = addr.street1 || '';
                
                // Handle district and county for previous addresses
                if (suffix) {
                    document.getElementById('district' + suffix).value = addr.district || '';
                    document.getElementById('county' + suffix).value = addr.county || '';
                } else {
                    // Current address also has district/county
                    const districtInput = document.getElementById('district');
                    const countyInput = document.getElementById('county');
                    if (districtInput) districtInput.value = addr.district || '';
                    if (countyInput) countyInput.value = addr.county || '';
                }
                
                document.getElementById('post_town' + suffix).value = addr.postTown || '';
                document.getElementById('post_code' + suffix).value = addr.postcode || '';

                // Clear any validation errors
                if (!suffix) {
                    Utils.clearError('street_error');
                    Utils.clearError('post_town_error');
                    Utils.clearError('post_code_error');
                    
                    // UPDATE APPSTATE AND VALIDATE FOR BUTTON VISIBILITY
                    AppState.addresses.current = {
                        building_number: document.getElementById('building_number').value || '',
                        building_name: document.getElementById('building_name').value || '',
                        flat: document.getElementById('flat').value || '',
                        street: document.getElementById('street').value || '',
                        district: document.getElementById('district').value || '',
                        county: document.getElementById('county').value || '',
                        post_town: document.getElementById('post_town').value || '',
                        post_code: document.getElementById('post_code').value || ''
                    };
                    validateStep2();  // Check if Continue button should show
                }
            });
        }
        
        // Manual toggle for previous addresses
        if (suffix) {
            const manualToggle = document.getElementById('manual_address_toggle' + suffix);
            const manualFields = document.getElementById('manual_address_fields' + suffix);
            
            if (manualToggle && manualFields) {
                manualToggle.addEventListener('click', () => {
                    if (manualFields.style.display === 'none') {
                        manualFields.style.display = 'block';
                        manualToggle.textContent = 'Use postcode lookup';
                    } else {
                        manualFields.style.display = 'none';
                        manualToggle.textContent = 'Enter address manually';
                    }
                    Utils.triggerResize();
                });
            }
        }
    },


    initStep3() {
        // Disable the Continue button on step 3 (we auto-advance, but show greyed out)
        const nextBtn = document.getElementById('next_to_step4');
        if (nextBtn) {
            nextBtn.disabled = true;
        }    

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
                    VisitorTracking.trackOTPStatus('sent');

                    
                    Utils.triggerResize(); // Trigger resize after showing OTP section
                } else {
                    console.error('OTP send failed:', result);
                    throw new Error(result.error || result.message || 'Failed to send OTP');
                }
            } catch (error) {
                console.error('OTP request error:', error);
                document.getElementById('otp_message').textContent = `Failed to send code: please try again`;
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
        
        // OTP input formatting and auto-submit
        const otpInput = document.getElementById('otp');
        if (otpInput) {
            // Format input to digits only
            otpInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
                
                // Auto-submit when 6 digits are entered
                if (e.target.value.length === 6) {
                    setTimeout(() => {
                        document.getElementById('verify_otp').click();
                    }, 300);
                }
            });
            
            // Handle paste event for auto-submit
            otpInput.addEventListener('paste', (e) => {
                e.preventDefault();
                const pastedData = (e.clipboardData || window.clipboardData).getData('text');
                const digits = pastedData.replace(/\D/g, '').slice(0, 6);
                otpInput.value = digits;
                
                if (digits.length === 6) {
                    setTimeout(() => {
                        document.getElementById('verify_otp').click();
                    }, 300);
                }
            });
            
            // Handle Enter key for auto-submit
            otpInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.preventDefault();
                    if (otpInput.value.length === 6) {
                        document.getElementById('verify_otp').click();
                    }
                }
            });
        }

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
                    // Keep button disabled since we're auto-advancing
                    const nextBtn = document.getElementById('next_to_step4');
                    if (nextBtn) {
                        nextBtn.disabled = true;  // Keep button disabled (greyed out)
                    }

                    Utils.clearError('otp_error');
                    VisitorTracking.trackOTPStatus('verified');
                    
                    // Auto-advance after verification (no need for continue button on step 3)
                    setTimeout(() => {
                        if (AppState.otpVerified) {
                            const mobileInput = document.getElementById('mobile');
                            if (mobileInput) {
                                AppState.formData.mobile = mobileInput.value;
                            }
                            Navigation.showStep('step4');
                        }
                    }, 1000); 

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
                //Navigation.populateReviewSummary();
                Navigation.showStep('step4');
            }
        });
    },

    initStep4() {
        // UPDATED FLOW: Single consent, then proceed button does both checks
        
        // Enable proceed button when consent is checked
        const consentCheckbox = document.getElementById('consent_checkbox');
        const proceedButton = document.getElementById('proceed_with_checks');
        
        // Initially disable the button (greyed out)
        proceedButton.disabled = true;
        
        consentCheckbox.addEventListener('change', () => {
            if (!consentCheckbox.checked) {
                proceedButton.disabled = true;
                proceedButton.classList.remove('btn-forward');
            } else {
                proceedButton.disabled = false;
                proceedButton.classList.add('btn-forward');
                highlightButton('proceed_with_checks');
            }            
        });

        // TEST MODE - REMOVE FOR PRODUCTION
        this.initTestMode();
        // END TEST MODE

        // Proceed with checks button - does BOTH identity AND credit check
        document.getElementById('proceed_with_checks').addEventListener('click', async () => {
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
                
                // Build data with addresses
                const data = {
                    title: document.getElementById('title').value,
                    firstName: document.getElementById('first_name').value,
                    middleName: document.getElementById('middle_name').value,
                    lastName: document.getElementById('last_name').value,
                    dateOfBirth: `${document.getElementById('dob_year').value}-${String(document.getElementById('dob_month').value).padStart(2, '0')}-${String(document.getElementById('dob_day').value).padStart(2, '0')}`,
                    mobile: mobile,
                    email: document.getElementById('email').value,
                    building_number: AppState.addresses.current.building_number,
                    building_name: AppState.addresses.current.building_name,
                    flat: AppState.addresses.current.flat,
                    street: AppState.addresses.current.street,
                    district: AppState.addresses.current.district,
                    county: AppState.addresses.current.county,
                    post_town: AppState.addresses.current.post_town,
                    post_code: AppState.addresses.current.post_code
                };
                
                // Add previous addresses if they exist
                if (AppState.previousAddressCount > 0 && AppState.addresses.previous1.post_code) {
                    data.previousAddress = AppState.addresses.previous1;
                }
                if (AppState.previousAddressCount > 1 && AppState.addresses.previous2.post_code) {
                    data.previousPreviousAddress = AppState.addresses.previous2;
                }
                
                const identityResult = await API.validateIdentity(data);
                
                // Hide the status div that was showing at the bottom
                const statusDiv = document.getElementById('identity_status');
                statusDiv.style.display = 'none';
                
                if (identityResult.success && identityResult.passed) {
                    AppState.identityVerified = true;
                    AppState.identityScore = identityResult.identityScore;
                    AppState.minimumScore = identityResult.minimumScore;
                    VisitorTracking.trackIdentityVerification('completed');
                    
                    // Store the Valifi response
                    if (identityResult.valifiResponse) {
                        AppState.valifiResponse = identityResult.valifiResponse;
                        console.log('Stored Valifi response from identity validation');
                    }
                    
                    // Store data for later use
                    AppState.reportData = {
                        ...data,
                        clientReference: 'report'
                    };
                    
                    // Show success modal
                    Utils.showSuccessModal(
                        'Identity Verified Successfully',
                        'Your identity has been verified successfully. Now retrieving your finance records...',
                        async () => {
                            // Hide change mobile section
                            document.getElementById('change_mobile_section').style.display = 'none';
                            
                            // AUTO-PROCEED: Show step 5 and run credit check
                            Navigation.showStep('step5');
                            await this.retrieveFinanceInformation();
                        }
                    );
                    
                } else {
                    // Show failure modal with contact info
                    const modalContent = `
                        We were unable to verify your identity. Please try a different mobile number linked to your credit file, or contact us:<br><br>
                        <strong>Email:</strong> <a href="mailto:claim@belmondclaims.com" style="color: #dc3545; text-decoration: underline;">claim@belmondclaims.com</a><br>
                        <strong>Phone:</strong> 03300948438<br>
                        Monday to Friday, 9am to 6pm
                    `;
                    
                    Utils.showErrorModal(modalContent);
                    
                    // Show change mobile section
                    document.getElementById('change_mobile_section').style.display = 'block';
                    Utils.triggerResize(); // Trigger resize after showing change mobile section
                }
            } catch (error) {
                console.error('Verification error:', error);
                Utils.showErrorModal('An error occurred during verification. Please try again.');
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
    },

    async retrieveFinanceInformation() {
        try {
            Utils.showLoading('Searching for your vehicle finance records...');
            // Track credit check initiated
            VisitorTracking.trackCreditCheck('initiated');            
            
            const result = await API.getCreditReport(AppState.reportData);
            AppState.pdfUrl = result.data?.pdfUrl;

            if (!result.data) {
                throw new Error('Failed to retrieve vehicle finance information');
            }
            
            // Store the full credit report response as well
            AppState.valifiResponse = result;
            // Track credit report storage if S3 URL is present
            if (result.data && result.data.pdfUrl) {
                VisitorTracking.trackCreditCheck('stored', {
                    s3_url: result.data.pdfUrl
                });
            }

            // Check for CMC detection
            checkCMCDetection();

            console.log('Stored FULL credit report (overwrites identity validation)', {
                size: JSON.stringify(result).length,
                hasConsumerCreditSearchResponse: !!(result.data && result.data.consumerCreditSearchResponse)
            });
            
            // Process and store results
            const summaryReport = result.data.summaryReport || result.data;
            const accounts = summaryReport.accounts || [];
            AppState.foundLenders = accounts;
            
            // Track credit check completed
            VisitorTracking.trackCreditCheck('completed', {
                lenders_count: accounts.length,
                cmc_detected: AppState.cmcDetectedInReport || false
            });

            // Prepare FLG data (DO NOT upload yet - wait for final submit)
            const mobile = AppState.reportData.mobile;
            const ukMobile = mobile.startsWith('44') ? '0' + mobile.substring(2) : mobile;

            const flgData = {
                // Use the form data the user entered, not the credit report name
                firstName: AppState.formData.first_name,
                lastName: AppState.formData.last_name, 
                title: AppState.formData.title,
                dateOfBirth: (() => {
                    // Read DOB directly from form fields (restored from working version)
                    const day = document.getElementById('dob_day')?.value || '';
                    const month = document.getElementById('dob_month')?.value || '';
                    const year = document.getElementById('dob_year')?.value || '';
                    
                    console.log('[DOB FIX] Reading DOB directly from DOM:');
                    console.log('  dob_day:', day);
                    console.log('  dob_month:', month);
                    console.log('  dob_year:', year);
                    
                    if (day && month && year) {
                        // Format as DD/MM/YYYY as expected by backend
                        const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
                        console.log('[DOB FIX] Formatted DOB:', formatted);
                        return formatted;
                    }
                    console.log('[DOB FIX] Missing DOB components, returning empty string');
                    return '';
                })(),

                phone1: ukMobile,
                email: AppState.reportData.email,
                address: [AppState.addresses.current.building_number, AppState.addresses.current.building_name, AppState.addresses.current.flat, AppState.addresses.current.street].filter(Boolean).join(' '),
                towncity: AppState.addresses.current.post_town,
                postcode: AppState.addresses.current.post_code,
                // Additional address fields
                building_number: AppState.addresses.current.building_number,
                building_name: AppState.addresses.current.building_name,
                flat: AppState.addresses.current.flat,
                street: AppState.addresses.current.street,
                post_town: AppState.addresses.current.post_town,
                post_code: AppState.addresses.current.post_code,
                accounts: accounts, // This will be updated to include manual lenders later
                pdfUrl: result.data.pdfUrl,
                signatureBase64: AppState.signatureBase64, // Will be added when final submit happens
                previousAddress: AppState.addresses.previous1,
                previousPreviousAddress: AppState.addresses.previous2,
                
                // ADD THESE NEW TRACKING FIELDS:
                source: AppState.tracking?.source || 'direct',
                medium: AppState.tracking?.medium || 'none',
                term: AppState.tracking?.term || '',
                
                // Keep campaign for backward compatibility  
                campaign: AppState.campaign || AppState.tracking?.campaign || ''
            };
            
            // Store FLG data for final submit (DO NOT upload yet)
            AppState.flgData = flgData;
            
            // Display results immediately
            this.displayLenders(AppState.foundLenders);
            
        } catch (error) {
            console.error('Finance retrieval error:', error);
            
            // Try to display as "no lenders found" rather than error
            AppState.foundLenders = [];
            this.displayLenders([]);
            
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
        highlightButton('next_to_step6');

    },

    initStep6() {
        // Populate final lenders list on entry
        this.populateFinalLendersList();
        
        // Get all section elements - CORRECT IDs from your HTML
        const section1 = document.getElementById('section1_final_steps');    // A - Understanding Options
        const section2 = document.getElementById('section2_existing_rep');   // B - Existing Representation
        const section3 = document.getElementById('section3_claim_types');    // C - Choose What Belmond Do
        const section4 = document.getElementById('section4_appointing');     // D - Appointing Belmond
        
        // Section 1 elements (A)
        const belmondChoiceConsent = document.getElementById('belmond_choice_consent');
        const choiceReasonWrapper = document.getElementById('choice_reason_wrapper');
        const choiceReason = document.getElementById('choice_reason');
        const otherReasonWrapper = document.getElementById('other_reason_wrapper');
        const otherReasonInput = document.getElementById('other_reason_input');
        const charCount = document.getElementById('char_count');
        
        // Section 2 elements (B - Existing Rep)
        const existingRepYes = document.getElementById('existing_rep_yes');
        const existingRepNo = document.getElementById('existing_rep_no');
        const professionalRepsSection = document.getElementById('professional_reps_section');
        const disengagementSection = document.getElementById('disengagement_section');
        const disengagementReason = document.getElementById('disengagement_reason');
        const disengagementOtherWrapper = document.getElementById('disengagement_other_wrapper');
        const disengagementOtherInput = document.getElementById('disengagement_other_input');
        
        // Section 3 elements (C - Claim Types)
        const motorFinanceConsent = document.getElementById('motor_finance_consent');
        const irresponsibleLendingConsent = document.getElementById('irresponsible_lending_consent');
        const marketingYes = document.getElementById('marketing_yes');
        const marketingNo = document.getElementById('marketing_no');
        const marketingError = document.getElementById('marketing_error');
        
        // Section 4 elements (D)
        const termsSignatureSection = document.getElementById('terms_signature_section');
        const signatureSection = document.querySelector('.signature-section');
        const finalSubmitContainer = document.querySelector('.final-submit-container');
        

        // IRL Warning Modal
        const irlWarningModal = document.getElementById('irl_warning_modal');
        let irlWarningShown = false;

        // Track what was just revealed for scrolling
        let lastRevealedSection = null;

        // Initialize marketing consent to null if undefined
        if (typeof AppState.mammothPromotionsConsent === 'undefined') {
            AppState.mammothPromotionsConsent = null;
        }

        // IRL Warning Modal handlers
        const setupIRLModalHandlers = () => {
            const modalNoAdd = document.getElementById('irl_modal_no_add');
            const modalAdd = document.getElementById('irl_modal_add');
            
            if (modalNoAdd) {
                modalNoAdd.addEventListener('click', () => {
                    // Close modal
                    if (irlWarningModal) {
                        irlWarningModal.style.display = 'none';
                    }
                    
                    // Scroll to Section D
                    if (section4) {
                        setTimeout(() => {
                            const sectionDHeading = section4.querySelector('h2') || section4;
                            sectionDHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                    }
                });
            }
            
            if (modalAdd) {
                modalAdd.addEventListener('click', () => {
                    // Close modal
                    if (irlWarningModal) {
                        irlWarningModal.style.display = 'none';
                    }
                    
                    // Tick the IRL checkbox
                    if (irresponsibleLendingConsent) {
                        irresponsibleLendingConsent.checked = true;
                        AppState.irresponsibleLendingConsent = true;
                        irlWarningShown = false;
                    }
                    
                    // Scroll to IRL section
                    const irlSection = irresponsibleLendingConsent?.closest('div[style*="border"]') ||
                                    irresponsibleLendingConsent?.parentElement?.parentElement;
                    if (irlSection) {
                        setTimeout(() => {
                            irlSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Highlight effect
                            irlSection.style.transition = 'background-color 0.5s';
                            irlSection.style.backgroundColor = '#e8f5e9';
                            setTimeout(() => {
                                irlSection.style.backgroundColor = '';
                            }, 2000);
                        }, 100);
                    }
                    
                    // Update UI
                    updateStep6UI();
                });
            }
        };

        // Call it immediately to set up handlers
        setupIRLModalHandlers();

        
        // CRITICAL: Single source of truth for section visibility
        const updateStep6UI = () => {
            // Check completion states
            const aComplete = (AppState.belmondChoiceConsent || (belmondChoiceConsent && belmondChoiceConsent.checked)) &&
                            (AppState.choiceReason || (choiceReason && choiceReason.value)) &&
                            (AppState.choiceReason !== 'Other' || AppState.otherReasonText || 
                            (otherReasonInput && otherReasonInput.value.trim()));
            
            const bComplete = aComplete && AppState.existingRepresentationConsent !== undefined &&
                            (AppState.existingRepresentationConsent === 'No' || 
                            (AppState.selectedProfessionalReps && AppState.selectedProfessionalReps.length > 0 &&
                            AppState.disengagementReason && 
                            (AppState.disengagementReason !== 'other' || AppState.disengagementOtherText)));
            
            const cComplete = bComplete && 
                            (AppState.motorFinanceConsent || (motorFinanceConsent && motorFinanceConsent.checked)) &&
                            typeof AppState.mammothPromotionsConsent === 'boolean';
            
            // SEQUENTIAL DISPLAY - ONLY ONE SECTION AT A TIME REVEALS
            
            // Section A is always visible
            if (section1) section1.style.display = 'block';
            
            // Section B shows ONLY after A is complete
            if (section2) {
                const shouldShowB = aComplete;
                const wasHidden = section2.style.display === 'none' || !section2.style.display;
                section2.style.display = shouldShowB ? 'block' : 'none';
                
                // Mark for scrolling if just revealed
                if (shouldShowB && wasHidden) {
                    lastRevealedSection = section2;
                    // Scroll with offset to show frame
                    setTimeout(() => {
                        const sectionTitle = section2.querySelector('h3, h2') || section2;
                        scrollToElement(sectionTitle, -40); // 40px offset to show frame
                    }, 300);
                }
            }
            
            // Section C shows ONLY after B is complete (NOT just after A!)
            if (section3) {
                const shouldShowC = bComplete;
                const wasHidden = section3.style.display === 'none' || !section3.style.display;
                section3.style.display = shouldShowC ? 'block' : 'none';
                
                // Mark for scrolling if just revealed
                if (shouldShowC && wasHidden) {
                    lastRevealedSection = section3;
                }
            }
            
            // IRL warning check - ALWAYS show when conditions met
            const hasMotorFinance = AppState.motorFinanceConsent || (motorFinanceConsent && motorFinanceConsent.checked);
            const marketingAnswered = typeof AppState.mammothPromotionsConsent === 'boolean';
            const hasIRL = AppState.irresponsibleLendingConsent || (irresponsibleLendingConsent && irresponsibleLendingConsent.checked);

            // Show modal when: motor finance YES + marketing answered + IRL NOT checked
            if (hasMotorFinance && marketingAnswered && !hasIRL) {
                if (!irlWarningShown || irlWarningModal.style.display === 'none') {
                    irlWarningShown = true;
                    if (irlWarningModal) {
                        irlWarningModal.style.display = 'block';
                    }
                }
            }

            // Reset warning flag if IRL gets checked
            if (hasIRL && irlWarningShown) {
                irlWarningShown = false;
                if (irlWarningModal) {
                    irlWarningModal.style.display = 'none';
                }
            }
            
            // Section D shows ONLY after C is complete
            if (section4) {
                const shouldShowD = cComplete;
                const wasHidden = section4.style.display === 'none' || !section4.style.display;
                section4.style.display = shouldShowD ? 'block' : 'none';
                
                // Mark for scrolling if just revealed
                if (shouldShowD && wasHidden) {
                    lastRevealedSection = section4;
                }
            }
            
            // Scroll to newly revealed section
            if (lastRevealedSection) {
                setTimeout(() => {
                    lastRevealedSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    lastRevealedSection = null;  // Reset after scrolling
                }, 100);
            }
            
            // Check final submit readiness
            this.checkFinalSubmitReady();
        };
        
        // Section A handlers
        if (belmondChoiceConsent) {
            belmondChoiceConsent.addEventListener('change', () => {
                AppState.belmondChoiceConsent = belmondChoiceConsent.checked;
                
                if (belmondChoiceConsent.checked) {
                    choiceReasonWrapper.style.display = 'block';
                    // Track FCA disclosure viewed (only once)
                    if (!AppState.fcaDisclosureViewed) {
                        AppState.fcaDisclosureViewed = true;
                        VisitorTracking.trackFCADisclosure('viewed', {
                            version: 'v1.0-2025-10-09'
                        });
                    }
                    // Don't scroll here - let the user see the dropdown first
                } else {
                    choiceReasonWrapper.style.display = 'none';
                    choiceReason.value = '';
                    AppState.choiceReason = '';
                    AppState.otherReasonText = '';
                }
                
                updateStep6UI();
            });
        }

        if (choiceReason) {
            choiceReason.addEventListener('change', () => {
                AppState.choiceReason = choiceReason.value;
                
                // Track FCA choice selected
                VisitorTracking.trackFCADisclosure('choice_selected', {
                    reason: choiceReason.value,
                    has_other: choiceReason.value === 'Other'
                });

                if (choiceReason.value === 'Other') {
                    otherReasonWrapper.style.display = 'block';
                    otherReasonInput.focus();
                } else {
                    otherReasonWrapper.style.display = 'none';
                    otherReasonInput.value = '';
                    AppState.otherReasonText = '';
                    
                    // Scrolling is handled by updateStep6UI() to avoid duplicate scrolls

                }
                
                updateStep6UI();
                this.blur();
            });
        }
        
        if (otherReasonInput) {
            otherReasonInput.addEventListener('input', () => {
                AppState.otherReasonText = otherReasonInput.value;
                if (charCount) {
                    charCount.textContent = otherReasonInput.value.length;
                }
                updateStep6UI();
            });
        }
        
    // Define showCMCDetectedModal function here so it's in scope
        const showCMCDetectedModal = () => {
            const modal = document.getElementById('cmc_detected_modal');
            if (!modal) {
                console.error('CMC detected modal not found');
                return;
            }
            modal.style.display = 'block';
            
            // Handle the Return button
            const returnBtn = document.getElementById('cmc_modal_return');
            if (returnBtn) {
                returnBtn.onclick = () => {
                    AppState.cmcModalHandled = true;
                    
                    // Force selection to Yes and disable No
                    const existingRepYes = document.getElementById('existing_rep_yes');
                    const existingRepNo = document.getElementById('existing_rep_no');
                    
                    if (existingRepYes) {
                        existingRepYes.checked = true;
                    }
                    if (existingRepNo) {
                        existingRepNo.checked = false;
                        existingRepNo.disabled = true;  // Prevent re-selecting No
                        // Also disable the label if you want
                        const noLabel = existingRepNo.closest('label');
                        if (noLabel) {
                            noLabel.style.opacity = '0.5';
                            noLabel.style.cursor = 'not-allowed';
                        }
                    }
                    
                    AppState.existingRepresentationConsent = 'Yes';
                    
                    // Show professional reps section
                    const professionalRepsSection = document.getElementById('professional_reps_section');
                    if (professionalRepsSection) {
                        professionalRepsSection.style.display = 'block';
                    }
                    
                    // Pre-select Unknown CMC
                    AppState.selectedProfessionalReps = [{
                        id: 'unknown_cmc',
                        name: 'Unknown firm (detected via credit report)',
                        type: 'CMC'
                    }];
                    
                    // Update the tokens display
                    const tokensContainer = document.getElementById('selected_reps_tokens');
                    if (tokensContainer) {
                        const tokenHtml = '<div class="rep-token" style="display: inline-block; padding: 6px 12px; margin: 4px; background: #007bff; color: white; border-radius: 20px;">Unknown CMC (detected via credit report)<span class="remove-token" style="cursor: pointer; margin-left: 8px;">×</span></div>';
                        tokensContainer.innerHTML = tokenHtml;
                    }
                    
                    // Show disengagement section
                    const disengagementSection = document.getElementById('disengagement_section');
                    if (disengagementSection) {
                        disengagementSection.style.display = 'block';
                    }
                    
                    // Close modal
                    modal.style.display = 'none';
                    
                    // Update UI
                    updateStep6UI();
                    
                };
            }
        };
        

        // Section B handlers (Existing Rep)
        if (existingRepYes) {
            existingRepYes.addEventListener('change', () => {
                if (existingRepYes.checked) {
                    AppState.existingRepresentationConsent = 'Yes';
                    professionalRepsSection.style.display = 'block';
                    
                    // Initialize professional representatives list and tokens
                    this.showRepDropdown();
                    this.updateSelectedTokensDisplay();
                    
                    setTimeout(() => {
                        professionalRepsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 100);
                    
                    updateStep6UI();
                }
            });
        }
        
    if (existingRepNo) {
            existingRepNo.addEventListener('change', () => {
                // ADD THIS PREVENTION CHECK
                if (AppState.cmcModalHandled && AppState.cmcDetectedInReport) {
                    existingRepNo.checked = false;
                    const existingRepYes = document.getElementById('existing_rep_yes');
                    if (existingRepYes) {
                        existingRepYes.checked = true;
                    }
                    alert("You cannot change this selection as CMC activity was detected in your credit report.");
                    return;
                }
                
                if (existingRepNo.checked) {
                    AppState.existingRepresentationConsent = 'No';
                    
                    // Check if CMC was detected and show modal
                    if (AppState.cmcDetectedInReport && !AppState.cmcModalHandled) {
                        showCMCDetectedModal();
                    } else {
                        // Clear selections if no CMC detected
                        AppState.selectedProfessionalReps = [];
                        AppState.disengagementReason = '';
                        AppState.disengagementOtherText = '';
                        
                        professionalRepsSection.style.display = 'none';
                        disengagementSection.style.display = 'none';
                    }
                    
                    updateStep6UI();
                }
            });
        }
        
        // Professional reps search for scrollable list
        const repSearchInput = document.getElementById('rep_search_input');
        const repListContainer = document.getElementById('rep_list_container');

        if (repSearchInput) {
            // Initialize the list on page load if section is visible
            if (professionalRepsSection && professionalRepsSection.style.display !== 'none') {
                this.showRepDropdown();
                this.updateSelectedTokensDisplay();
            }
            
            // Live filter as user types
            repSearchInput.addEventListener('input', (e) => {
                this.filterProfessionalReps(e.target.value);
            });
            
            // Prevent form submission on Enter key
            repSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });
            
            // Optional: Clear search on focus for better UX
            repSearchInput.addEventListener('focus', (e) => {
                if (!e.target.value) {
                    this.showRepDropdown(); // Show full list when focused with empty search
                }
            });
        }

        
        // Disengagement handlers
        disengagementReason.addEventListener('change', () => {
            AppState.disengagementReason = disengagementReason.value;

            // Track disengagement reason selection
            VisitorTracking.trackDetailedEvent('disengagement_selected', {
                reason: disengagementReason.value,
                other_text: AppState.disengagementOtherText || ''
            });
            
            if (disengagementReason.value === 'other') {
                disengagementOtherWrapper.style.display = 'block';
                disengagementOtherInput.focus();
            } else {
                disengagementOtherWrapper.style.display = 'none';
                disengagementOtherInput.value = '';
                AppState.disengagementOtherText = '';
            }
            
            // Show disengagement section when firms are selected
            if (AppState.selectedProfessionalReps && AppState.selectedProfessionalReps.length > 0) {
                disengagementSection.style.display = 'block';
            }
            
            updateStep6UI();
                    
            // Close dropdown on mobile after selection
            this.blur();
        });
        
        if (disengagementOtherInput) {
            disengagementOtherInput.addEventListener('input', () => {
                AppState.disengagementOtherText = disengagementOtherInput.value;
                updateStep6UI();
            });
        }
        
        // Section C handlers (Claim Types)
        if (motorFinanceConsent) {
            motorFinanceConsent.addEventListener('change', () => {
                AppState.motorFinanceConsent = motorFinanceConsent.checked;
                
                // Track motor finance consent
                VisitorTracking.trackDetailedEvent('consent_update', {
                    consent_type: 'motor_finance',
                    value: motorFinanceConsent.checked
                });

                // When motor finance is ticked, scroll to IRL section at top of screen
                if (motorFinanceConsent.checked) {
                    // Find the IRL heading by its exact text
                    const headings = document.querySelectorAll('h3');
                    let irlHeading = null;
                    
                    for (const h of headings) {
                        if (h.textContent.includes('Irresponsible Lending & Affordability Claims')) {
                            irlHeading = h;
                            break;
                        }
                    }
                    
                    if (irlHeading) {
                        setTimeout(() => {
                            scrollToElement(irlHeading, -40); // Use helper with offset
                        }, 100);
                    }
                }
                
                updateStep6UI();
            });
        }

        if (irresponsibleLendingConsent) {
            irresponsibleLendingConsent.addEventListener('change', () => {
                AppState.irresponsibleLendingConsent = irresponsibleLendingConsent.checked;

                // Track IRL consent
                VisitorTracking.trackDetailedEvent('consent_update', {
                    consent_type: 'irresponsible_lending', 
                    value: irresponsibleLendingConsent.checked
                });

                if (irresponsibleLendingConsent.checked) {
                    irlWarningShown = false;
                    
                    // When IRL is ticked, scroll to Marketing Preferences
                    const marketingHeading = document.getElementById('mammoth_promotions_section')?.querySelector('h3') ||
                                            marketingYes?.closest('div')?.parentElement?.querySelector('h3');
                    if (marketingHeading) {
                        setTimeout(() => {
                            scrollToElement(marketingHeading, -40); // Use helper with offset
                        }, 100);
                    }
                }
                
                updateStep6UI();
            });
        }
                
        // Marketing consent handlers
        if (marketingYes) {
            marketingYes.addEventListener('change', () => {
                if (marketingYes.checked) {
                    AppState.mammothPromotionsConsent = true;
                    if (marketingError) marketingError.style.display = 'none';
                    
                    // Force modal check immediately after marketing is answered
                    const hasMotorFinance = AppState.motorFinanceConsent || 
                                        document.getElementById('motor_finance_consent')?.checked;
                    const hasIRL = AppState.irresponsibleLendingConsent || 
                                document.getElementById('irresponsible_lending_consent')?.checked;
                    
                    if (hasMotorFinance && !hasIRL) {
                        const modal = document.getElementById('irl_warning_modal');
                        if (modal) modal.style.display = 'block';
                    } else {
                        // Scroll to D - Appointing Belmond
                        setTimeout(() => {
                            const section4 = document.getElementById('section4_appointing');
                            if (section4 && section4.style.display !== 'none') {
                                const sectionHeading = section4.querySelector('h2');
                                if (sectionHeading) {
                                    sectionHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }
                        }, 500);
                    }
                    
                    updateStep6UI();
                }
            });
        }

        if (marketingNo) {
            marketingNo.addEventListener('change', () => {
                if (marketingNo.checked) {
                    AppState.mammothPromotionsConsent = false;
                    if (marketingError) marketingError.style.display = 'none';
                    
                    // Force modal check immediately after marketing is answered
                    const hasMotorFinance = AppState.motorFinanceConsent || 
                                        document.getElementById('motor_finance_consent')?.checked;
                    const hasIRL = AppState.irresponsibleLendingConsent || 
                                document.getElementById('irresponsible_lending_consent')?.checked;
                    
                    if (hasMotorFinance && !hasIRL) {
                        const modal = document.getElementById('irl_warning_modal');
                        if (modal) modal.style.display = 'block';
                    } else {
                        // Scroll to D - Appointing Belmond
                        setTimeout(() => {
                            const section4 = document.getElementById('section4_appointing');
                            if (section4 && section4.style.display !== 'none') {
                                const sectionHeading = section4.querySelector('h2');
                                if (sectionHeading) {
                                    sectionHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }
                        }, 500);
                    }
                    
                    updateStep6UI();
                }
            });
        }
        
        // Section D: Terms & Signature handlers
        const termsCheckbox = document.getElementById('terms_checkbox');
        const termsLink = document.getElementById('terms_link');

        // Clicking the bold Terms & Conditions text opens modal
        if (termsLink) {
            termsLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent checkbox toggle
                this.showTermsModal();
            });
        }

        // Checkbox change shows/hides signature
        if (termsCheckbox) {
            termsCheckbox.addEventListener('change', () => {
                AppState.termsAccepted = termsCheckbox.checked;
                
                const signatureSection = document.querySelector('.signature-section');
                if (termsCheckbox.checked && signatureSection) {
                    signatureSection.style.display = 'block';
                    setTimeout(() => {
                        this.initSignatureCanvas();
                        signatureSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 100);
                } else if (!termsCheckbox.checked && signatureSection) {
                    signatureSection.style.display = 'none';
                    AppState.signatureSigned = false;
                    // Clear signature canvas
                    const canvas = document.getElementById('signature_canvas');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                }
                this.checkFinalSubmitReady();
            });
        }
                
        // Final submit button
        const submitButton = document.getElementById('final_submit_form');
        if (submitButton) {
            submitButton.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.handleFinalSubmit();
            });
        }
        
        // Navigation
        const backButton = document.getElementById('back_to_step5');
        if (backButton) {
            backButton.addEventListener('click', () => {
                if (!AppState.claimSubmitted) {
                    Navigation.showStep('step5');
                }
            });
        }
        
        // Restore state if returning to this step
        if (AppState.belmondChoiceConsent) {
            belmondChoiceConsent.checked = true;
            choiceReasonWrapper.style.display = 'block';
        }
        
        if (AppState.choiceReason) {
            choiceReason.value = AppState.choiceReason;
            if (AppState.choiceReason === 'Other' && AppState.otherReasonText) {
                otherReasonWrapper.style.display = 'block';
                otherReasonInput.value = AppState.otherReasonText;
                if (charCount) charCount.textContent = AppState.otherReasonText.length;
            }
        }
        
        if (AppState.motorFinanceConsent) {
            motorFinanceConsent.checked = true;
        }
        
        if (AppState.irresponsibleLendingConsent) {
            irresponsibleLendingConsent.checked = true;
        }
        
        // Only restore if user previously made a selection
        if (AppState.mammothPromotionsConsent === true) {
            marketingYes.checked = true;
        } else if (AppState.mammothPromotionsConsent === false) {
            marketingNo.checked = true;
        }

        if (AppState.existingRepresentationConsent === 'Yes') {
            existingRepYes.checked = true;
            professionalRepsSection.style.display = 'block';
            if (AppState.selectedProfessionalReps && AppState.selectedProfessionalReps.length > 0) {
                this.updateSelectedRepsList();
                disengagementSection.style.display = 'block';
            }
        } else if (AppState.existingRepresentationConsent === 'No') {
            existingRepNo.checked = true;
        }
        
        if (AppState.disengagementReason) {
            disengagementReason.value = AppState.disengagementReason;
            if (AppState.disengagementReason === 'other' && AppState.disengagementOtherText) {
                disengagementOtherWrapper.style.display = 'block';
                disengagementOtherInput.value = AppState.disengagementOtherText;
            }
        }
        
        // Check if form was submitted
        if (AppState.claimSubmitted) {
            this.disableFormAfterSubmission();
        }
        
        // Initial UI update
        updateStep6UI();
    },

    // ADD THIS NEW FUNCTION after initStep6()
    populatePersonalInfoSummary() {
        const summaryDiv = document.getElementById('personal_info_summary');
        if (!summaryDiv) return;
        
        const formatDate = (day, month, year) => {
            if (!day || !month || !year) return 'Not provided';
            return `${day}/${month}/${year}`;
        };
        
        const personalInfo = {
            'Full Name': `${AppState.formData.title || ''} ${AppState.formData.first_name || ''} ${AppState.formData.last_name || ''}`.trim(),
            'Date of Birth': formatDate(
                AppState.formData.dob_day,
                AppState.formData.dob_month,
                AppState.formData.dob_year
            ),
            'Email': AppState.formData.email || 'Not provided',
            'Mobile': AppState.formData.mobile || 'Not provided',
            'Address': AppState.formData.address || 'Not provided',
            'Town/City': AppState.formData.towncity || 'Not provided',
            'Postcode': AppState.formData.postcode || 'Not provided'
        };
        
        let html = '<div style="display: grid; gap: 10px;">';
        for (const [label, value] of Object.entries(personalInfo)) {
            html += `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef;">
                    <span style="font-weight: 600; color: #6c757d;">${label}:</span>
                    <span style="color: #333;">${value}</span>
                </div>
            `;
        }
        html += '</div>';
        
        summaryDiv.innerHTML = html;
    },

    // UNIQUE ANCHOR START: new progressive disclosure for Step 6
    checkAndShowConsentSections() {
        // Elements
        const claimTypeConsents      = document.getElementById('claim_type_consents');
        const dcaCheckbox            = document.getElementById('motor_finance_consent');
        const irlRow                 = document.getElementById('irresponsible_lending_row') || document.getElementById('irresponsible_lending_consent_wrapper');
        const irlCheckbox            = document.getElementById('irresponsible_lending_consent');

        const marketingSection       = document.getElementById('mammoth_promotions_section');
        const marketingYes           = document.getElementById('marketing_yes');
        const marketingNo            = document.getElementById('marketing_no');

        const existingRepSection     = document.getElementById('existing_representation_section');
        const termsSignatureSection  = document.getElementById('terms_signature_section');

        // Helper: smooth reveal + scroll ONLY when appropriate
        const revealAndScroll = (el, shouldScroll = false) => {
            if (!el) return;
            const wasHidden = el.style.display === 'none' || el.style.display === '';
            
            if (wasHidden) {
                el.style.display = 'block';
            }
            
            // Only scroll if explicitly requested and element was just revealed
            if (shouldScroll && wasHidden) {
                setTimeout(() => {
                    const yOffset = -100;
                    const rect = el.getBoundingClientRect();
                    const y = rect.top + window.pageYOffset + yOffset;
                    window.scrollTo({
                        top: y,
                        behavior: 'smooth'
                    });
                }, 200);
            }
        };

        // 0) Ensure claim type wrapper visible only once FCA choice is ticked and reason set
        const belmondChoiceGiven = !!AppState.belmondChoiceConsent && !!AppState.choiceReason;
        if (claimTypeConsents) {
            claimTypeConsents.style.display = belmondChoiceGiven ? 'block' : 'none';
        }
        if (!belmondChoiceGiven) {
            // hide downstream sections until FCA choice completed
            if (irlRow)            irlRow.style.display = 'none';
            if (marketingSection)  marketingSection.style.display = 'none';
            if (existingRepSection) existingRepSection.style.display = 'none';
            if (termsSignatureSection) termsSignatureSection.style.display = 'none';
            return;
        }

        // Track what triggered this call by checking what just changed
        const dcaJustChecked = dcaCheckbox && dcaCheckbox.checked && !AppState._lastDcaState;
        const irlJustChecked = irlCheckbox && irlCheckbox.checked && !AppState._lastIrlState;
        const marketingJustAnswered = typeof AppState.mammothPromotionsConsent === 'boolean' && 
                                    AppState.mammothPromotionsConsent !== AppState._lastMarketingState;

        // Update tracking states
        AppState._lastDcaState = dcaCheckbox ? dcaCheckbox.checked : false;
        AppState._lastIrlState = irlCheckbox ? irlCheckbox.checked : false;
        AppState._lastMarketingState = AppState.mammothPromotionsConsent;

        // 1) DCA (Motor finance) - When ticked => show IRL row
        const dcaGiven = !!AppState.motorFinanceConsent || (dcaCheckbox && dcaCheckbox.checked);
        
        if (!dcaGiven) {
            if (irlRow) irlRow.style.display = 'none';
            if (marketingSection) marketingSection.style.display = 'none';
            if (existingRepSection) existingRepSection.style.display = 'none';
            if (termsSignatureSection) termsSignatureSection.style.display = 'none';
            return;
        }

        // Show IRL row when DCA is checked
        if (irlRow) {
            const wasHidden = irlRow.style.display === 'none';
            irlRow.style.display = 'block';
            // Only scroll to IRL if DCA was JUST checked
            if (dcaJustChecked && wasHidden) {
                revealAndScroll(irlRow, true);
                return; // Stop here to prevent scrolling to other sections
            }
        }

        // 2) IRL - when ticked, show Marketing
        const irlGiven = !!AppState.irresponsibleLendingConsent || (irlCheckbox && irlCheckbox.checked);
        
        if (!irlGiven) {
            if (marketingSection) marketingSection.style.display = 'none';
            if (existingRepSection) existingRepSection.style.display = 'none';
            if (termsSignatureSection) termsSignatureSection.style.display = 'none';
            return;
        }

        // Show Marketing section when IRL is checked
        if (marketingSection) {
            const wasHidden = marketingSection.style.display === 'none';
            marketingSection.style.display = 'block';
            // Only scroll to Marketing if IRL was JUST checked
            if (irlJustChecked && wasHidden) {
                revealAndScroll(marketingSection, true);
                return; // Stop here to prevent scrolling to other sections
            }
        }

        // 3) Marketing (Yes/No radio) - must be answered to proceed
        const marketingAnswered = typeof AppState.mammothPromotionsConsent === 'boolean' ||
                                (marketingYes && marketingYes.checked) ||
                                (marketingNo && marketingNo.checked);

        if (!marketingAnswered) {
            if (existingRepSection) existingRepSection.style.display = 'none';
            if (termsSignatureSection) termsSignatureSection.style.display = 'none';
            return;
        }

        // 4) Existing Representation section (after Marketing answered)
        if (existingRepSection) {
            const wasHidden = existingRepSection.style.display === 'none';
            existingRepSection.style.display = 'block';
            // Only scroll to Existing Rep if Marketing was JUST answered
            if (marketingJustAnswered && wasHidden) {
                revealAndScroll(existingRepSection, true);
                return; // Stop here to prevent scrolling to other sections
            }
        }

        // 5) Terms & Signature comes last
        if (termsSignatureSection && AppState.existingRepresentationConsent !== undefined) {
            const repJustAnswered = AppState.existingRepresentationConsent !== AppState._lastRepState;
            AppState._lastRepState = AppState.existingRepresentationConsent;
            
            const wasHidden = termsSignatureSection.style.display === 'none';
            termsSignatureSection.style.display = 'block';
            
            // Only scroll to Terms if Rep was JUST answered
            if (repJustAnswered && wasHidden) {
                revealAndScroll(termsSignatureSection, true);
                
                // Re-initialize signature canvas when terms section becomes visible
                setTimeout(() => {
                    this.initSignatureCanvas();
                }, 300);
            }
        }
    },



    // NEW: Add this function after initStep6()
    checkProgressiveDisclosure() {
        const termsSignatureSection = document.getElementById('terms_signature_section');
        
        // Check if checkbox is ticked AND reason is selected (or Other with text)
        const needsOtherText = AppState.choiceReason === 'Other';
        const hasOtherText = AppState.otherReasonText && AppState.otherReasonText.trim().length > 0;
        const hasValidReason = AppState.choiceReason && (!needsOtherText || hasOtherText);
        
        // Show terms section only when all conditions are met
        if ((AppState.motorFinanceConsent || AppState.irresponsibleLendingConsent) && 
            AppState.belmondChoiceConsent && 
            hasValidReason) {
            
            termsSignatureSection.style.display = 'block';
            
            // Re-initialize signature canvas when section becomes visible
            setTimeout(() => {
                const canvas = document.getElementById('signature_canvas');
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                }
                termsSignatureSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        } else {
            termsSignatureSection.style.display = 'none';
            // DON'T clear the signature state when hiding the section
            // AppState.signatureSigned = false;
            // AppState.signatureBase64 = null;
        }
    },

    checkProgressiveDisclosureExtended() {
        const mammothSection = document.getElementById('mammoth_promotions_section');
        const termsSignatureSection = document.getElementById('terms_signature_section');
        
        // Check complete flow state
        const hasClaimTypeConsent = AppState.motorFinanceConsent || AppState.irresponsibleLendingConsent;
        const needsOtherText = AppState.choiceReason === 'Other';
        const hasOtherText = AppState.otherReasonText && AppState.otherReasonText.trim().length > 0;
        const hasValidReason = AppState.choiceReason && (!needsOtherText || hasOtherText);
        const hasFCAChoice = AppState.belmondChoiceConsent && hasValidReason;
        
        // Check representation state
        const hasRepresentationAnswer = AppState.existingRepresentationConsent !== null;
        const needsFirmSelection = AppState.existingRepresentationConsent === 'Yes';
        const hasFirmSelection = !needsFirmSelection || AppState.selectedProfessionalReps.length > 0;
        
        // Show terms when everything above is complete
        if (hasClaimTypeConsent && hasFCAChoice && hasRepresentationAnswer && hasFirmSelection) {
            termsSignatureSection.style.display = 'block';
            setTimeout(() => {
                this.initSignatureCanvas();
                termsSignatureSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
        
        // Show Mammoth section when terms are complete
        const termsCheckbox = document.getElementById('terms_checkbox');
        if (termsCheckbox && termsCheckbox.checked && AppState.signatureSigned) {
            mammothSection.style.display = 'block';
            setTimeout(() => {
                mammothSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    },

    checkAndShowRepresentationSection() {
        const existingRepSection = document.getElementById('existing_representation_section');
        
        // Check if claim type consents are checked
        const hasClaimTypeConsent = AppState.motorFinanceConsent || AppState.irresponsibleLendingConsent;
        
        // Check if FCA choice is complete
        const needsOtherText = AppState.choiceReason === 'Other';
        const hasOtherText = AppState.otherReasonText && AppState.otherReasonText.trim().length > 0;
        const hasValidReason = AppState.choiceReason && (!needsOtherText || hasOtherText);
        const hasFCAChoice = AppState.belmondChoiceConsent && hasValidReason;
        
        // Show representation section when both conditions are met
        if (hasClaimTypeConsent && hasFCAChoice) {
            existingRepSection.style.display = 'block';
            setTimeout(() => {
                existingRepSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        } else {
            existingRepSection.style.display = 'none';
        }
    },


    // NEW: Professional Representatives Management Functions
    professionalRepsData: [],


    // Replace the whole function body with this
    async loadProfessionalRepresentatives(retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000; // ms

        console.log(`loadProfessionalRepresentatives attempt ${retryCount + 1} of ${MAX_RETRIES + 1}`);

        try {
            const resp = await fetch('/professional-representatives', { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            // hard sort A→Z by name to match “old code” behaviour
            data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            this.professionalRepsData = data;

            // keep your split lists (used elsewhere)
            AppState.cmcList = data.filter(r => r.type === 'CMC' || r.type === 'Both');
            AppState.sraList = data.filter(r => r.type === 'SRA' || r.type === 'Both');

            console.log(`Loaded ${data.length} reps (CMC ${AppState.cmcList.length}, SRA ${AppState.sraList.length})`);
            return true;
        } catch (err) {
            console.error(`Error loading professional representatives (attempt ${retryCount + 1}):`, err);

            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY * Math.pow(2, retryCount);
                console.log(`Retrying in ${delay}ms…`);
                await new Promise(r => setTimeout(r, delay));
                return this.loadProfessionalRepresentatives(retryCount + 1);
            }

            console.error('Failed after retries — using fallback');
            this.useFallbackProfessionalReps?.();
            return false;
        }
    },


    showRepDropdown() {
        const listContainer = document.getElementById('rep_list_container');
        if (listContainer) {
            this.renderRepDropdown(this.professionalRepsData);
        }
    },

    filterProfessionalReps(searchTerm) {
        const filtered = this.professionalRepsData.filter(rep => 
            rep.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        this.renderRepDropdown(filtered);
    },

    renderRepDropdown(reps) {
        const listContainer = document.getElementById('rep_list_container');
        if (!listContainer) return;
        
        const searchInput = document.getElementById('rep_search_input');
        const searchTerm = searchInput ? searchInput.value : '';
        
        let availableReps = reps.filter(rep => 
            !AppState.selectedProfessionalReps.some(r => r.id === rep.id)
        );
        
        if (searchTerm) {
            availableReps = availableReps.filter(rep => 
                rep.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        
        if (availableReps.length === 0) {
            listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No firms available</div>';
            return;
        }
        
        listContainer.innerHTML = availableReps.map(rep => `
            <div class="rep-list-item" 
                data-rep-id="${rep.id}" 
                data-rep-name="${rep.name}"
                style="padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; transition: background-color 0.2s;">
                <span>${rep.name}</span>
                <span style="color: #0066cc; font-size: 20px;">+</span>
            </div>
        `).join('');
        
        listContainer.querySelectorAll('.rep-list-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#f0f8ff';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = '';
            });
            item.addEventListener('click', () => {
                const repId = parseInt(item.dataset.repId);
                const repName = item.dataset.repName;
                AppState.selectedProfessionalReps.push({ id: repId, name: repName });
                // Check for TLW Solicitors
                if (repName && repName.toLowerCase().includes('tlw solicitors')) {
                    showTLWModal();
                    AppState.tlwSolicitorsSelected = true;
                    
                    // Change the motor finance description text
                    const motorFinanceDesc = document.getElementById('motor_finance_description');
                    if (motorFinanceDesc) {
                        motorFinanceDesc.textContent = 'You can pursue your commission claim yourself for free. If you instruct Belmond & Co to pursue Irresponsible Lending & Affordability Claims (see below), we will work in partnership with TLW Solicitors who will continue to represent you on your Motor Finance Commission Claim.';
                    }
                    
                    // Hide the motor finance checkbox row
                    const motorFinanceCheckbox = document.getElementById('motor_finance_consent');
                    if (motorFinanceCheckbox) {
                        const motorFinanceContainer = motorFinanceCheckbox.closest('.checkbox-row') || 
                                                     motorFinanceCheckbox.closest('label')?.parentElement ||
                                                     motorFinanceCheckbox.parentElement?.parentElement;
                        if (motorFinanceContainer) {
                            motorFinanceContainer.style.display = 'none';
                            motorFinanceContainer.setAttribute('data-tlw-hidden', 'true');
                        }
                        // Force motor finance consent for flow
                        motorFinanceCheckbox.checked = true;
                        AppState.motorFinanceConsent = true;
                    }
                }


                this.updateSelectedFirmsDisplay();
                this.renderRepDropdown(this.professionalRepsData);
            });
        });
    },

    updateSelectedFirmsDisplay() {
        const tokensContainer = document.getElementById('selected_reps_tokens');
        if (!tokensContainer) return;
        
        // Check for TLW Solicitors in selected reps
        const tlwSelected = AppState.selectedProfessionalReps.some(rep => 
            rep.name && rep.name.toLowerCase().includes('tlw solicitors')
        );
        
        // Update TLW state and change text accordingly
        if (tlwSelected) {
            AppState.tlwSolicitorsSelected = true;
            
            // Change the motor finance description text
            const motorFinanceDesc = document.getElementById('motor_finance_description');
            if (motorFinanceDesc) {
                motorFinanceDesc.textContent = 'You can pursue your commission claim yourself for free. If you instruct Belmond & Co to additionally pursue Irresponsible Lending & Affordability Claims, where applicable, we will work in partnership with TLW Solicitors who will continue to represent you on your Motor Finance Commission Claim.';
            }
            
            // Hide the motor finance checkbox
            const motorFinanceCheckbox = document.getElementById('motor_finance_consent');
            if (motorFinanceCheckbox) {
                const motorFinanceContainer = motorFinanceCheckbox.closest('div[style*="padding: 20px"]');
                if (motorFinanceContainer) {
                    motorFinanceContainer.style.display = 'none';
                    motorFinanceContainer.setAttribute('data-tlw-hidden', 'true');
                }
                // Force motor finance consent for flow
                motorFinanceCheckbox.checked = true;
                AppState.motorFinanceConsent = true;
            }
            
            // Show TLW modal only once
            if (!window.tlwModalShown) {
                showTLWModal();
                window.tlwModalShown = true;
            }
        } else {
            AppState.tlwSolicitorsSelected = false;
            window.tlwModalShown = false; // Reset modal flag
            
            // Restore original motor finance description text
            const motorFinanceDesc = document.getElementById('motor_finance_description');
            if (motorFinanceDesc) {
                motorFinanceDesc.textContent = 'You can pursue your commission claim yourself for free. If you instruct Belmond & Co, we will represent you within the rules of the scheme and/or pursue your claim outside the scheme where appropriate.';
            }
            
            // Show motor finance checkbox again
            const hiddenMotorFinance = document.querySelector('[data-tlw-hidden="true"]');
            if (hiddenMotorFinance) {
                hiddenMotorFinance.style.display = '';
                hiddenMotorFinance.removeAttribute('data-tlw-hidden');
            }
            
            // Reset motor finance consent
            const motorFinanceCheckbox = document.getElementById('motor_finance_consent');
            if (motorFinanceCheckbox) {
                motorFinanceCheckbox.checked = false;
                motorFinanceCheckbox.disabled = false;
                AppState.motorFinanceConsent = false;
            }
        }
        
        // Continue with original display logic
        if (AppState.selectedProfessionalReps.length > 0) {
            tokensContainer.innerHTML = AppState.selectedProfessionalReps.map(rep => `
                <span style="display: inline-flex; align-items: center; padding: 6px 12px; background: #0066cc; color: white; border-radius: 20px; font-size: 14px; margin: 4px;">
                    <span>${rep.name}</span>
                    <span class="remove-token" data-rep-id="${rep.id}" style="cursor: pointer; font-weight: bold; font-size: 18px; margin-left: 8px;">&times;</span>
                </span>
            `).join('');
            
            tokensContainer.querySelectorAll('.remove-token').forEach(btn => {
                btn.addEventListener('click', () => {
                    const repId = parseInt(btn.dataset.repId);
                    AppState.selectedProfessionalReps = AppState.selectedProfessionalReps.filter(r => r.id !== repId);
                    this.updateSelectedFirmsDisplay();
                    this.renderRepDropdown(this.professionalRepsData);
                });
            });
            
            const disengagementSection = document.getElementById('disengagement_section');
            if (disengagementSection) {
                disengagementSection.style.display = 'block';
            }
        } else {
            tokensContainer.innerHTML = '<div style="color: #999; font-style: italic;">No firms selected yet</div>';
            
            const disengagementSection = document.getElementById('disengagement_section');
            if (disengagementSection) {
                disengagementSection.style.display = 'none';
            }
        }
    },


    selectProfessionalRep(repId, repName) {
        // Convert repId to integer for comparison
        repId = parseInt(repId);
        
        // Add to selection
        AppState.selectedProfessionalReps.push({ 
            id: repId, 
            name: repName 
        });
        
        // Track professional rep selection
        VisitorTracking.trackProfessionalRep(
            AppState.selectedProfessionalReps,
            AppState.disengagementReason
        );

        // Update displays
        this.updateSelectedTokensDisplay();
        
        // Re-render list to remove selected item
        const searchInput = document.getElementById('rep_search_input');
        const searchTerm = searchInput ? searchInput.value : '';
        this.filterProfessionalReps(searchTerm);
        
        // Clear search after selection
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        
        // Check if we need to show/hide disengagement section
        const disengagementSection = document.getElementById('disengagement_section');
        if (AppState.selectedProfessionalReps.length > 0 && disengagementSection) {
            disengagementSection.style.display = 'block';
        }
        
        this.checkProgressiveDisclosureExtended();
    },

    removeProfessionalRep(repId) {
        // Convert repId to integer for comparison
        repId = parseInt(repId);
        
        // Remove from selection
        const index = AppState.selectedProfessionalReps.findIndex(r => r.id === repId);
        if (index > -1) {
            AppState.selectedProfessionalReps.splice(index, 1);
        }
        
        // Update displays
        this.updateSelectedTokensDisplay();
        
        // Re-render list to show removed item again
        const searchInput = document.getElementById('rep_search_input');
        const searchTerm = searchInput ? searchInput.value : '';
        this.filterProfessionalReps(searchTerm);
        
        // Check if we need to hide disengagement section
        const disengagementSection = document.getElementById('disengagement_section');
        if (AppState.selectedProfessionalReps.length === 0 && disengagementSection) {
            disengagementSection.style.display = 'none';
        }
        
        this.checkProgressiveDisclosureExtended();
    },

    updateSelectedTokensDisplay() {
        const tokensContainer = document.getElementById('selected_reps_tokens');
        
        if (!tokensContainer) return;
        
        if (AppState.selectedProfessionalReps.length > 0) {
            // Create tokens for selected firms
            tokensContainer.innerHTML = AppState.selectedProfessionalReps.map(rep => `
                <span class="rep-token">
                    <span class="token-text">${rep.name}</span>
                    <span class="remove-token" data-rep-id="${rep.id}" title="Remove">&times;</span>
                </span>
            `).join('');
            
            // Add click handlers to remove buttons
            tokensContainer.querySelectorAll('.remove-token').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const repId = parseInt(btn.dataset.repId);
                    this.removeProfessionalRep(repId);
                });
            });
            
            // Show validation is complete
            const validationMsg = document.getElementById('rep_validation_message');
            if (validationMsg) {
                validationMsg.style.display = 'none';
            }
        } else {
            // Show placeholder when no firms selected
            tokensContainer.innerHTML = '<div style="color: #999; font-style: italic; padding: 10px 0;">No firms selected yet</div>';
        }
    },

    // NEW: Disable all navigation buttons after submission

    disableFormAfterSubmission() {
        // Disable all inputs in step 6
        const step6 = document.getElementById('step6');
        if (!step6) return;
        
        // Disable all checkboxes and radios
        step6.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(input => {
            input.disabled = true;
        });
        
        // Disable all selects
        step6.querySelectorAll('select').forEach(select => {
            select.disabled = true;
        });
        
        // Disable all textareas
        step6.querySelectorAll('textarea').forEach(textarea => {
            textarea.disabled = true;
        });
        
        // Disable navigation buttons
        const backButtons = ['back_to_step5'];
        backButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
        
        // Update submit button
        const submitBtn = document.getElementById('final_submit_form');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
            submitBtn.textContent = '✓ Claim Submitted';
        }
        
        // Hide signature buttons
        const clearSigBtn = document.getElementById('clear_signature');
        const autoSignBtn = document.getElementById('auto_sign');
        if (clearSigBtn) clearSigBtn.style.display = 'none';
        if (autoSignBtn) autoSignBtn.style.display = 'none';
        
        // Make signature canvas read-only
        const canvas = document.getElementById('signature_canvas');
        if (canvas) {
            canvas.style.pointerEvents = 'none';
            canvas.style.opacity = '0.8';
        }

        // Show Section 4: Appointing Belmond
        const section4 = document.getElementById('section4_appointing');
        if (section4) {
            section4.style.display = 'block';
            section4.style.opacity = '0';
            setTimeout(() => {
                section4.style.transition = 'opacity 0.5s ease-in';
                section4.style.opacity = '1';
                section4.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 500);
        }        

    },

    // NEW: Show terms modal with scroll requirement

    async showTermsModal() {
        const modal = document.getElementById('terms_modal');
        
        // Add null check
        if (!modal) {
            console.error('Terms modal not found in DOM');
            alert('Unable to load terms modal. Please refresh the page.');
            return;
        }
        
        const termsContent = document.getElementById('terms_content');
        const termsBody = document.getElementById('terms_body');
        const closeBtn = document.getElementById('close_terms_btn') || document.getElementById('close_terms_modal');
        
        // Add null checks for critical elements
        if (!termsContent || !termsBody || !closeBtn) {
            console.error('Terms modal elements missing');
            return;
        }
        
        // Load terms content
        try {
            Utils.showLoading('Loading terms...');
            const content = await API.fetchTermsContent();
            termsContent.innerHTML = content;
            Utils.hideLoading();
        } catch (error) {
            Utils.hideLoading();
            termsContent.innerHTML = '<p style="color: red;">Failed to load terms. Please try again.</p>';
            console.error('Failed to load terms:', error);
            return;
        }
        
        // Show modal
        modal.style.display = 'flex';
        termsBody.scrollTop = 0;
        
        // Track that terms were opened
        if (typeof VisitorTracking !== 'undefined' && VisitorTracking.trackTerms) {
            VisitorTracking.trackTerms('opened');
        }
        
        // Simple close button handler - no conditions
        const closeHandler = () => {
            modal.style.display = 'none';
        };
        
        // Remove existing listener if any and add new one
        closeBtn.removeEventListener('click', closeHandler);
        closeBtn.addEventListener('click', closeHandler);
        
        // Close modal when clicking outside
        const modalClickHandler = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };
        
        modal.removeEventListener('click', modalClickHandler);
        modal.addEventListener('click', modalClickHandler);
        
        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                modal.style.display = 'none';
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    initSignatureCanvas() {
        const canvas = document.getElementById('signature_canvas');
        if (!canvas) return;
        
        // If we already have a signature, don't reinitialize
        if (AppState.signatureSigned && AppState.signatureBase64) {
            // Restore the existing signature instead of clearing
            const img = new Image();
            img.onload = function() {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            };
            img.src = AppState.signatureBase64;
            return;
        }
        
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        
        // Set canvas size properly
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Clear any existing signature ONLY if we don't have one saved
        if (!AppState.signatureBase64) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }




        // Remove ALL existing event listeners first
        const newCanvas = canvas.cloneNode(true);
        canvas.parentNode.replaceChild(newCanvas, canvas);
        const signatureCanvas = document.getElementById('signature_canvas');
        const context = signatureCanvas.getContext('2d');
        
        // Drawing functions
        const startDrawing = (e) => {
            isDrawing = true;
            const rect = signatureCanvas.getBoundingClientRect();
            
            if (e.type === 'touchstart') {
                lastX = e.touches[0].clientX - rect.left;
                lastY = e.touches[0].clientY - rect.top;
            } else {
                lastX = e.clientX - rect.left;
                lastY = e.clientY - rect.top;
            }
        };
        
        const draw = (e) => {
            if (!isDrawing) return;
            
            const rect = signatureCanvas.getBoundingClientRect();
            let currentX, currentY;
            
            if (e.type === 'touchmove') {
                e.preventDefault();
                currentX = e.touches[0].clientX - rect.left;
                currentY = e.touches[0].clientY - rect.top;
            } else {
                currentX = e.clientX - rect.left;
                currentY = e.clientY - rect.top;
            }
            
            context.beginPath();
            context.moveTo(lastX, lastY);
            context.lineTo(currentX, currentY);
            context.strokeStyle = '#000';
            context.lineWidth = 2;
            context.lineCap = 'round';
            context.stroke();
            
            lastX = currentX;
            lastY = currentY;
            
            // Mark as signed but DON'T update sections during drawing
            AppState.signatureSigned = true;
            AppState.signatureBase64 = signatureCanvas.toDataURL();
            // REMOVED: this.checkFinalSubmitReady();
            // REMOVED: this.checkAndShowConsentSections();
        };

        const stopDrawing = () => {
            isDrawing = false;
            // Don't do ANY checks here - just stop drawing
        };

        const finishDrawing = () => {
            // Track signature provided (only once)
            if (AppState.signatureSigned && !AppState.signatureTracked) {
                AppState.signatureTracked = true; // Prevent duplicate tracking
                VisitorTracking.trackSignature('provided');
            }
            
            if (AppState.signatureSigned) {
                // Only check readiness when intentionally finishing
                this.checkFinalSubmitReady();

            }
        };
                        
        // Add event listeners
        signatureCanvas.addEventListener('mousedown', startDrawing);
        signatureCanvas.addEventListener('mousemove', draw);
        signatureCanvas.addEventListener('mouseup', (e) => {
            stopDrawing();
            finishDrawing();  // Check readiness only on mouseup
        });
        signatureCanvas.addEventListener('mouseout', stopDrawing);  // Just stop, don't finish

        // Touch events
        signatureCanvas.addEventListener('touchstart', startDrawing);
        signatureCanvas.addEventListener('touchmove', draw);
        signatureCanvas.addEventListener('touchend', (e) => {
            stopDrawing();
            finishDrawing();  // Check readiness only on touchend
        });
                
        // Prevent canvas clicks from closing sections
        signatureCanvas.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        signatureCanvas.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        }, { passive: false });

        // Clear signature button
        const clearBtn = document.getElementById('clear_signature');
        if (clearBtn) {
            // Remove old listener
            const newClearBtn = clearBtn.cloneNode(true);
            clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
            
            newClearBtn.addEventListener('click', () => {
                context.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
                AppState.signatureSigned = false;
                AppState.signatureBase64 = null;
                
                // DO NOT call checkFinalSubmitReady() - it causes sections to hide
                // Just update the submit button directly
                const submitBtn = document.getElementById('final_submit_form');
                if (submitBtn) {
                    const ready = AppState.termsAccepted && AppState.signatureSigned;
                    submitBtn.disabled = !ready;
                    if (!ready) submitBtn.classList.remove('btn-ready');
                }
            });
        }
        
        // Auto-sign button
        const autoSignBtn = document.getElementById('auto_sign');  // CORRECT ID: auto_sign not auto_sign_btn
        if (autoSignBtn) {
            // Remove old listener first
            const newAutoSignBtn = autoSignBtn.cloneNode(true);
            autoSignBtn.parentNode.replaceChild(newAutoSignBtn, autoSignBtn);
            
            newAutoSignBtn.addEventListener('click', () => {
                const name = `${AppState.formData.first_name || ''} ${AppState.formData.last_name || ''}`.trim();
                if (name) {
                    const canvas = document.getElementById('signature_canvas');
                    const context = canvas.getContext('2d');
                    
                    // Clear the canvas first
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Draw the signature
                    context.font = 'italic 30px cursive';
                    context.fillStyle = '#000';
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.fillText(name, canvas.width / 2, canvas.height / 2);
                    
                    // Mark as signed
                    AppState.signatureSigned = true;
                    AppState.signatureBase64 = canvas.toDataURL();
                    
                    // DO NOT call checkAndShowConsentSections() or checkFinalSubmitReady()
                    // Just update submit button directly without triggering section hiding
                    const submitBtn = document.getElementById('final_submit_form');
                    if (submitBtn && AppState.termsAccepted) {
                        submitBtn.disabled = false;
                        submitBtn.classList.add('btn-ready');
                    }
                } else {
                    alert('Please complete Step 1 with your name before using Auto-Sign.');
                }
            });
        }        
    },


    // Fallback data if API fails
    getFallbackProfessionalReps() {
        return [
            { id: 1, name: 'ACL Consultancy Ltd' },
            { id: 2, name: 'Addlington West Group' },
            { id: 3, name: 'Alawco Limited' },
            { id: 4, name: 'AMK Legal Ltd' },
            { id: 5, name: 'Bott and Co Solicitors Ltd' },
            { id: 6, name: 'CEL Solicitors' },
            { id: 7, name: 'Keller Postman UK' },
            { id: 8, name: 'Leigh Day' },
            { id: 9, name: 'Pogust Goodhead' },
            { id: 10, name: 'Slater and Gordon Lawyers' },
            // Add more as needed
        ];
    },


    checkFinalSubmitReady() {
        const submitButton = document.getElementById('final_submit_form');
        if (!submitButton) return false;
        
        let isReady = true;
        let reasons = [];
        
        // Track final submit readiness check
        VisitorTracking.trackDetailedEvent('page_event', {
            event: 'final_submit_ready_check',
            timestamp: new Date().toISOString()
        });


        // Check Section 2: Consents & Declarations
        // 1. FCA Choice must be checked
        if (!AppState.belmondChoiceConsent) {
            isReady = false;
            reasons.push('Please confirm you want Belmond to manage your claim');
        }
        
        // 2. Choice reason must be selected
        const needsOtherText = AppState.choiceReason === 'Other';
        const hasOtherText = AppState.otherReasonText && AppState.otherReasonText.trim().length > 0;
        if (!AppState.choiceReason || (needsOtherText && !hasOtherText)) {
            isReady = false;
            reasons.push('Please select why you chose Belmond');
        }
        
        // 3. At least one claim type must be selected
        if (!AppState.motorFinanceConsent && !AppState.irresponsibleLendingConsent) {
            isReady = false;
            reasons.push('Please select at least one claim type');
        }
        
        // 4. Marketing preference must be answered
        if (typeof AppState.mammothPromotionsConsent !== 'boolean') {
            isReady = false;
            reasons.push('Please select your marketing preference');
        }
        
        // 5. Existing representation must be answered
        if (AppState.existingRepresentationConsent === undefined) {
            isReady = false;
            reasons.push('Please answer about existing representation');
        }
        
        // 6. If existing representation is Yes, need firms and reason
        if (AppState.existingRepresentationConsent === 'Yes') {
            // Check both property names for backwards compatibility
            const hasProfessionalReps = (AppState.professionalReps && AppState.professionalReps.length > 0) || 
                                        (AppState.selectedProfessionalReps && AppState.selectedProfessionalReps.length > 0);
            
            if (!hasProfessionalReps) {
                isReady = false;
                reasons.push('Please select firms to disengage');
            }
            
            // Ensure professionalReps is set for other code that might use it
            if (!AppState.professionalReps && AppState.selectedProfessionalReps) {
                AppState.professionalReps = AppState.selectedProfessionalReps;
            }
            
            
            const needsDisengagementOther = AppState.disengagementReason === 'Other';
            const hasDisengagementOther = AppState.disengagementOtherText && AppState.disengagementOtherText.trim().length > 0;
            if (!AppState.disengagementReason || (needsDisengagementOther && !hasDisengagementOther)) {
                isReady = false;
                reasons.push('Please provide reason for changing representation');
            }
        }
        
        // 7. Terms must be accepted (check the checkbox)
        const termsCheckbox = document.getElementById('terms_checkbox');
        AppState.termsAccepted = termsCheckbox && termsCheckbox.checked;
        if (!AppState.termsAccepted) {
            isReady = false;
            reasons.push('Please accept the Terms & Conditions');
        }
        
        // 8. Signature must be provided
        if (!AppState.signatureSigned) {
            isReady = false;
            reasons.push('Please provide your signature');
        }
        
        // Update submit button state
        if (isReady) {
            submitButton.disabled = false;
            submitButton.title = 'Click to submit your claim';
            
            // Show Section 3 (Terms & Signature) if all consents are complete
            const termsSection = document.getElementById('terms_signature_section');
            if (termsSection && termsSection.style.display === 'none') {
                termsSection.style.display = 'block';
                termsSection.style.opacity = '0';
                setTimeout(() => {
                    termsSection.style.transition = 'opacity 0.3s ease-in';
                    termsSection.style.opacity = '1';
                }, 50);
            }
        } else {
            submitButton.disabled = true;
            submitButton.title = reasons.join('\n');
        }
        
        // Show submit button container if signature provided
        const finalSubmitContainer = document.querySelector('.final-submit-container');
        if (AppState.termsAccepted && AppState.signatureSigned && finalSubmitContainer) {
            finalSubmitContainer.style.display = 'block';
            
            // Auto-scroll to submit button after a short delay
            setTimeout(() => {
                // Mobile-friendly smooth scroll
                finalSubmitContainer.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',  // Center the button in viewport
                    inline: 'nearest' 
                });
                
                // Add attention-grabbing class
                const submitBtn = document.getElementById('final_submit_form');
                if (submitBtn) {
                    submitBtn.classList.add('pulse-highlight');
                }
            }, 300); // Small delay to ensure element is visible
        }


        return isReady;
    },


    scrollToNextSection(targetId) {
        // Small delay to ensure DOM updates
        setTimeout(() => {
            const targetElement = document.getElementById(targetId);
            if (targetElement && targetElement.style.display !== 'none') {
                const yOffset = -100; // Offset from top
                const y = targetElement.getBoundingClientRect().top + window.pageYOffset + yOffset;
                
                window.scrollTo({
                    top: y,
                    behavior: 'smooth'
                });
            }
        }, 300);
    },

    populateFinalLendersList() {
        const finalList = document.getElementById('final_lenders_list');
        if (!finalList) return;
        
        finalList.innerHTML = '';
        
        // Get categories from backend response (set by handleFinalSubmit)
        const categories = AppState.submissionCategories || {
            proceeding: [],
            outside_range: [],
            not_in_database: []
        };
        
        // Helper function to create lender icon HTML
        const createLenderIconHTML = (lender) => {
            if (lender.logoFile || lender.filename) {
                const iconFile = lender.logoFile || lender.filename;
                return `
                    <img src="/static/icons/${encodeURIComponent(iconFile)}" 
                        alt="${lender.name}" 
                        class="lender-icon"
                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="lender-icon-fallback" style="display: none;">
                        ${lender.name.substring(0, 2).toUpperCase()}
                    </div>
                `;
            } else {
                // No icon available - show initials
                return `
                    <div class="lender-icon-fallback">
                        ${lender.name.substring(0, 2).toUpperCase()}
                    </div>
                `;
            }
        };
        
        // CATEGORY 1: Proceeding (Green)
        if (categories.proceeding && categories.proceeding.length > 0) {
            const cat1Section = document.createElement('div');
            cat1Section.className = 'category-section category-proceeding';
            cat1Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">✅</span>
                    Lenders We Are Proceeding With (${categories.proceeding.length})
                </h3>
                <p class="category-description">
                    These lenders are within the eligible criteria and Belmond will actively pursue claims on your behalf
                </p>
            `;
            
            const cat1List = document.createElement('div');
            cat1List.className = 'category-lenders-list';
            
            categories.proceeding.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                
                let claimInfo = '';
                if (lender.dca_reference) {
                    claimInfo += `<span class="claim-badge dca">${lender.dca_reference}</span>`;
                }
                if (lender.irl_created) {
                    // OLD CODE:
                    // claimInfo += `<span class="claim-badge irl">IRL Suspense</span>`;
                    
                    // NEW CODE - Dynamic based on reference value:
                    // Note: You'll need to pass the actual IRL reference value from backend
                    // For now, assuming it's passed as lender.irl_reference
                    const irlRef = lender.irl_reference || 
                                (lender.eligible === 'Yes' ? 'Verified IRL Portfolio' : 'IRL Suspnse');
                    claimInfo += `<span class="claim-badge irl">${irlRef}</span>`;
                }
            


                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                            <div class="lender-meta">
                                <span class="lender-source">${lender.source}</span>
                                ${lender.startDate ? `<span class="lender-date">${formatDateDisplay(lender.startDate)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="lender-claims">${claimInfo}</div>
                `;
                
                cat1List.appendChild(lenderDiv);
            });
            
            cat1Section.appendChild(cat1List);
            finalList.appendChild(cat1Section);
        }
        
        // CATEGORY 2: Outside Date Range (Yellow)
        if (categories.outside_range && categories.outside_range.length > 0) {
            const cat2Section = document.createElement('div');
            cat2Section.className = 'category-section category-outside-range';
            cat2Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">⚠️</span>
                    Lenders Outside Eligible Date Range (${categories.outside_range.length})
                </h3>
                <p class="category-description">
                    These agreements fall outside the eligible period (6 Apr '07 - 1 Nov '24) and cannot be pursued
                </p>
            `;
            
            const cat2List = document.createElement('div');
            cat2List.className = 'category-lenders-list';
            
            categories.outside_range.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                            ${lender.reason ? `<div class="lender-reason">${lender.reason}</div>` : ''}
                        </div>
                    </div>
                `;
                cat2List.appendChild(lenderDiv);
            });
            
            cat2Section.appendChild(cat2List);
            finalList.appendChild(cat2Section);
        }
        
        // CATEGORY 3: Not in Database (Grey)
        if (categories.not_in_database && categories.not_in_database.length > 0) {
            const cat3Section = document.createElement('div');
            cat3Section.className = 'category-section category-not-proceeding';
            cat3Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">ℹ️</span>
                    Lenders We Are Not Actively Pursuing (${categories.not_in_database.length})
                </h3>
                <p class="category-description">
                    These lenders are not in our current database of actively pursued claims. If you believe this should be included, please contact us.
                </p>
            `;
            
            const cat3List = document.createElement('div');
            cat3List.className = 'category-lenders-list';
            
            categories.not_in_database.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                        </div>
                    </div>
                `;
                cat3List.appendChild(lenderDiv);
            });
            
            cat3Section.appendChild(cat3List);
            finalList.appendChild(cat3Section);
        }
    },

    async handleFinalSubmit() {
        if (AppState.claimSubmitted) {
            console.log('Claim already submitted');
            return;
        }
        
        const submitButton = document.getElementById('final_submit_form');
        submitButton.disabled = true;
        
        try {
            Utils.showLoading('Submitting your claim...');
            
            // Complete summary object for final submission
            const summary = {
                // Personal Information - from Step 1
                firstName: AppState.formData.first_name || '',
                lastName: AppState.formData.last_name || '',
                email: AppState.formData.email || '',
                title: AppState.formData.title || '',
                dateOfBirth: (() => {
                    const day = document.getElementById('dob_day')?.value || '';
                    const month = document.getElementById('dob_month')?.value || '';
                    const year = document.getElementById('dob_year')?.value || '';
                    if (day && month && year) {
                        return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
                    }
                    return '';
                })(),
                
                // Phone/Mobile
                phone1: AppState.formData.mobile || AppState.formData.phone1 || AppState.formData.phone || '',

                mobile: AppState.formData.mobile || AppState.formData.phone1 || AppState.formData.phone || '',
                
                // Address fields - read from AppState.addresses.current (where they are stored)
                building_number: AppState.addresses?.current?.building_number || AppState.formData.building_number || '',
                building_name: AppState.addresses?.current?.building_name || AppState.formData.building_name || '',
                flat: AppState.addresses?.current?.flat || AppState.formData.flat || '',
                street: AppState.addresses?.current?.street || AppState.formData.street || '',
                towncity: AppState.addresses?.current?.post_town || AppState.formData.post_town || AppState.formData.towncity || '',
                post_town: AppState.addresses?.current?.post_town || AppState.formData.post_town || AppState.formData.towncity || '',
                postcode: AppState.addresses?.current?.post_code || AppState.formData.post_code || AppState.formData.postcode || AppState.formData.postCode || '',
                post_code: AppState.addresses?.current?.post_code || AppState.formData.post_code || AppState.formData.postcode || AppState.formData.postCode || '',
                postCode: AppState.addresses?.current?.post_code || AppState.formData.post_code || AppState.formData.postcode || AppState.formData.postCode || '',

                // Previous addresses
                previousAddress: AppState.addresses.previous1 || null,
                previousPreviousAddress: AppState.addresses.previous2 || null,
                
                // Identity Verification
                identityScore: AppState.identityScore || 0,
                identityVerified: AppState.identityVerified || false,
                valifiResponse: AppState.valifiResponse || null,
                
                // FCA Choice Consent
                belmondChoiceConsent: AppState.belmondChoiceConsent || false,
                choiceReason: AppState.choiceReason || '',
                otherReasonText: AppState.otherReasonText || '',
                
                // Main Claim Consents
                motorFinanceConsent: AppState.motorFinanceConsent || false,
                irresponsibleLendingConsent: AppState.irresponsibleLendingConsent || false,
                
                // Existing Representation - UPDATED WITH DISENGAGEMENT
                existingRepresentationConsent: AppState.existingRepresentationConsent || null,
                selectedProfessionalReps: AppState.selectedProfessionalReps || [],
                tlwSolicitorsSelected: AppState.tlwSolicitorsSelected || false,
                disengagementReason: AppState.disengagementReason || '',
                disengagementOtherText: AppState.disengagementOtherText || '',
                
                // Marketing Consent
                mammothPromotionsConsent: AppState.mammothPromotionsConsent || false,
                
                // Signature
                signatureBase64: AppState.signatureBase64 || '',
                termsAccepted: AppState.termsAccepted || false,
                
                // Lenders
                foundLenders: AppState.foundLenders || [],
                additionalLenders: AppState.additionalLenders || [],
                accounts: [...(AppState.foundLenders || []), ...(AppState.additionalLenders || [])],
                
                // PDF URL
                pdfUrl: AppState.pdfUrl || '',
                
                // Campaign tracking
                campaign: window.location.search.substring(1) || AppState.campaign || 'Unknown',
                clientIp: AppState.clientIp || '',
                source: AppState.tracking?.source || 'direct',
                medium: AppState.tracking?.medium || 'none',
                term: AppState.tracking?.term || '',
                
                // Session tracking
                session_id: VisitorTracking?.sessionId || null,
                
                // Debug information
                submissionTimestamp: new Date().toISOString(),
                appVersion: '1.0',
                userAgent: navigator.userAgent || '',
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                sessionId: AppState.sessionId || null
            };

            // Debug logging
            console.log('='.repeat(80));
            console.log('FINAL SUBMISSION SUMMARY:');
            console.log('Identity Score:', summary.identityScore);
            console.log('Postcode:', summary.postcode);
            console.log('Signature present:', !!summary.signatureBase64);
            console.log('Valifi Response present:', !!summary.valifiResponse);
            console.log('Found Lenders:', summary.foundLenders.length);
            console.log('Manual Lenders:', summary.additionalLenders.length);
            console.log('Motor Finance Consent:', summary.motorFinanceConsent);
            console.log('IRL Consent:', summary.irresponsibleLendingConsent);
            console.log('Existing Representation:', summary.existingRepresentationConsent);
            console.log('Selected Firms:', summary.selectedProfessionalReps);
            console.log('Disengagement Reason:', summary.disengagementReason);
            console.log('Campaign:', summary.campaign);
            console.log('Full summary keys:', Object.keys(summary));
            console.log('='.repeat(80));
            
            // Validate required fields
            if (!summary.firstName || !summary.lastName || !summary.email) {
                throw new Error('Missing required personal information. Please complete all steps.');
            }
            
            // Submit to backend
            const response = await fetch('/upload_summary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(summary)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.error || `Server error: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Submission result:', result);
            
            // Mark as submitted
            AppState.claimSubmitted = true;
            
            // Store categories if returned
            if (result.categories) {
                AppState.submissionCategories = result.categories;
            }
            
            // Store lead IDs if returned
            if (result.lead_ids) {
                AppState.leadIds = result.lead_ids;
            }
            
            // Disable the form after submission
            this.disableFormAfterSubmission();
            
            // Show success and redirect
            window.location.href = '/thankyou';

            // Tracking events
            if (typeof gtag !== 'undefined') {
                gtag('event', 'form_submit', {
                    'event_category': 'engagement',
                    'event_label': 'claim_submission'
                });
            }
            
        } catch (error) {
            console.error('Submission error:', error);
            alert(error.message || 'There was an error submitting your claim. Please try again.');
            submitButton.disabled = false;
        } finally {
            Utils.hideLoading();
        }
    },

    showSuccessAndRedirect(result) {
        // First, try to use the existing success modal in the HTML
        const successModal = document.getElementById('success_modal');
        
        if (successModal) {
            // Show the modal
            successModal.style.display = 'block';
            
            // Update message with details if available
            const messageElement = successModal.querySelector('.success-message');
            if (messageElement && result) {
                let message = 'Your vehicle finance claim has been submitted successfully.';
                
                if (result.lead_ids && result.lead_ids.length > 0) {
                    message += ` We have created ${result.lead_ids.length} lead(s) with your lender(s).`;
                }
                
                message += ' We will now contact the applicable lenders to confirm what commission, if any, was paid out with your agreement and by what method.';
                
                messageElement.textContent = message;
            }
            
            // Add click handlers
            const overlay = successModal.querySelector('.success-modal-overlay');
            const closeBtn = successModal.querySelector('.success-close');
            
            const redirectToThankYou = () => {
                // Redirect to thank you page after closing modal
                window.location.href = '/thankyou';
            };
            
            if (overlay) {
                overlay.onclick = redirectToThankYou;
            }
            
            if (closeBtn) {
                closeBtn.onclick = redirectToThankYou;
            }
            
            // Auto-redirect after 5 seconds
            setTimeout(redirectToThankYou, 5000);
            
        } else if (typeof Utils !== 'undefined' && Utils.showSuccessModal) {
            // Fallback to Utils.showSuccessModal if available
            Utils.showSuccessModal(
                'Claim Submitted Successfully!',
                'Your claim has been successfully submitted. You will be redirected to our thank you page.',
                () => {
                    window.location.href = '/thankyou';
                }
            );
        } else {
            // Last resort - simple alert and redirect
            alert('Claim submitted successfully! You will now be redirected to our thank you page.');
            window.location.href = '/thankyou';
        }
    },
        
    initFormSubmission() {
        // Form submission is now handled in initStep6
    },

    displayLenders(accounts) {
        console.log('Displaying lenders:', accounts);
        
        const combinedList = document.getElementById('combined_lenders_list');
        const stepSubtitle = document.querySelector('#step5 .step-subtitle');
        
        if (!combinedList) {
            console.error('Combined lenders list element not found');
            return;
        }
        
        // Clear existing content
        combinedList.innerHTML = '';
        
        // Combine found lenders with manually added lenders
        const allLenders = [...accounts, ...AppState.additionalLenders];
        
        if (allLenders.length === 0) {
            combinedList.innerHTML = '<p class="no-lenders-message">No finance agreements found. Please use the "Add Lenders Manually" button below if you remember any specific lenders.</p>';
            return;
        }
        
        const eligibleLenders = [];
        const outsideRangeLenders = [];
        const notInDatabaseLenders = [];
        
        // Categorize each lender  
        allLenders.forEach(lender => {
            const isManual = AppState.additionalLenders.includes(lender);
            const isEligible = lender.dateEligible !== false;
            
            // Match lender from database
            const matchedLender = Utils.findBestMatchingLender(lender.displayName || lender.name || lender.lenderName);
            
            // ONLY use database name if EXACT match (similarity = 1.0)
            // Otherwise show original credit file name so user can verify fuzzy matches
            const isExactMatch = matchedLender && matchedLender.similarity === 1.0;
            
            const lenderData = {
                // ✨ CHANGED: Only use clean database name for EXACT matches (1.0)
                name: isExactMatch ? matchedLender.name : (lender.displayName || lender.name || lender.lenderName || 'Unknown Lender'),
                source: isManual ? 'Manual' : 'Valifi',
                startDate: lender.startDate || '',
                logoFile: matchedLender ? matchedLender.filename : null,
                filename: matchedLender ? matchedLender.filename : null
            };            

            // Categorize
            if (matchedLender) {
                // In database
                if (isManual || isEligible) {
                    eligibleLenders.push(lenderData);
                } else {
                    // Valifi + outside date range
                    outsideRangeLenders.push(lenderData);
                }
            } else {
                // Not in database
                notInDatabaseLenders.push(lenderData);
            }
        });
        
        // Helper function to create lender icon HTML
        const createLenderIconHTML = (lender) => {
            if (lender.logoFile || lender.filename) {
                const iconFile = lender.logoFile || lender.filename;
                return `
                    <img src="/static/icons/${encodeURIComponent(iconFile)}" 
                        alt="${lender.name}" 
                        class="lender-icon"
                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="lender-icon-fallback" style="display: none;">
                        ${lender.name.substring(0, 2).toUpperCase()}
                    </div>
                `;
            } else {
                return `
                    <div class="lender-icon-fallback">
                        ${lender.name.substring(0, 2).toUpperCase()}
                    </div>
                `;
            }
        };
        
        // CATEGORY 1: Proceeding - NO SOURCE BADGE
        if (eligibleLenders.length > 0) {
            const cat1Section = document.createElement('div');
            cat1Section.className = 'category-section category-proceeding';
            cat1Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">✅</span>
                    Lenders We Are Proceeding With
                </h3>
                <p class="category-description">
                    These lenders are within the eligible criteria and Belmond will actively pursue claims on your behalf
                </p>
            `;
            
            const cat1List = document.createElement('div');
            cat1List.className = 'category-lenders-list';
            
            eligibleLenders.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                            ${lender.startDate ? `<div class="lender-meta"><span class="lender-date">${formatDateDisplay(lender.startDate)}</span></div>` : ''}
                        </div>
                    </div>
                `;
                cat1List.appendChild(lenderDiv);
            });
            
            cat1Section.appendChild(cat1List);
            combinedList.appendChild(cat1Section);
        }
        
        // CATEGORY 2: Outside Date Range - NO SOURCE BADGE
        if (outsideRangeLenders.length > 0) {
            const cat2Section = document.createElement('div');
            cat2Section.className = 'category-section category-outside-range';
            cat2Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">⚠️</span>
                    Lenders Outside Eligible Date Range
                </h3>
                <p class="category-description">
                    These agreements fall outside the eligible period (6 Apr '07 - 1 Nov '24) and cannot be pursued
                </p>
            `;
            
            const cat2List = document.createElement('div');
            cat2List.className = 'category-lenders-list';
            
            outsideRangeLenders.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                            ${lender.startDate ? `<div class="lender-meta"><span class="lender-date-warning">${formatDateDisplay(lender.startDate)}</span></div>` : ''}
                        </div>
                    </div>
                `;
                cat2List.appendChild(lenderDiv);
            });
            
            cat2Section.appendChild(cat2List);
            combinedList.appendChild(cat2Section);
        }
        
        // CATEGORY 3: Not in Database - NO SOURCE BADGE
        if (notInDatabaseLenders.length > 0) {
            const cat3Section = document.createElement('div');
            cat3Section.className = 'category-section category-not-proceeding';
            cat3Section.innerHTML = `
                <h3 class="category-title">
                    <span class="category-icon">ℹ️</span>
                    Lenders We Are Not Actively Pursuing
                </h3>
                <p class="category-description">
                    These lenders are not those where we are actively pursuing claims on behalf of clients - you may still proceed with the claim directly yourself.
                </p>
            `;
            
            const cat3List = document.createElement('div');
            cat3List.className = 'category-lenders-list';
            
            notInDatabaseLenders.forEach(lender => {
                const lenderDiv = document.createElement('div');
                lenderDiv.className = 'lender-item';
                lenderDiv.innerHTML = `
                    <div class="lender-header">
                        <div class="lender-icon-container">
                            ${createLenderIconHTML(lender)}
                        </div>
                        <div class="lender-info">
                            <div class="lender-name">${lender.name}</div>
                            ${lender.startDate ? `<div class="lender-meta"><span class="lender-date">${formatDateDisplay(lender.startDate)}</span></div>` : ''}
                        </div>
                    </div>
                `;
                cat3List.appendChild(lenderDiv);
            });
            
            cat3Section.appendChild(cat3List);
            combinedList.appendChild(cat3Section);
        }
        
        // Update subtitle
        if (stepSubtitle) {
            const total = allLenders.length;
            const eligible = eligibleLenders.length;
            const outside = outsideRangeLenders.length;
            
            if (outside > 0 && eligible === 0) {
                stepSubtitle.textContent = 'We found agreements, but they fall outside the eligible date range';
            } else if (outside > 0) {
                stepSubtitle.textContent = `We found ${total} agreements (${eligible} eligible, ${outside} outside date range)`;
            } else {
                stepSubtitle.textContent = 'We found the following finance agreements';
            }
        }

        // Enable the proceed button when we have lenders to process
        const proceedBtn = document.getElementById('next_to_step6');
        if (proceedBtn) {
            const hasLendersToProcess = allLenders.length > 0;
            if (hasLendersToProcess) {
                proceedBtn.disabled = false;
                proceedBtn.classList.add('btn-forward');
                highlightButton('next_to_step6');
            } else {
                proceedBtn.disabled = true;
                proceedBtn.classList.remove('btn-forward');
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
        
        // Updated modal with improved header and button layout, no X button
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3>Select Additional Lenders</h3>
                </div>
                <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px; margin-bottom: 10px;">
                    <input type="text" class="lender-search" placeholder="Search lenders..." style="border: 2px solid #97D1CB; margin-bottom: 1rem;">
                    <div class="lenders-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.75rem;">
                        ${availableLenders.map(lender => `
                            <div class="lender-option" data-name="${lender.name}" data-filename="${lender.filename || ''}" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.5rem; border: 2px solid #97D1CB; border-radius: 8px; cursor: pointer; transition: all 0.3s; min-height: 120px; background: white;">
                                ${lender.filename ? 
                                    `<img src="/static/icons/${encodeURIComponent(lender.filename)}" alt="${lender.name}" style="width: 80px; height: 80px; object-fit: contain; margin-bottom: 0.25rem;">` :
                                    `<div class="no-logo-placeholder" style="width: 80px; height: 80px; background: linear-gradient(135deg, #212045 0%, #2E5652 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.7rem; text-align: center; padding: 0.25rem; margin-bottom: 0.25rem;">${lender.name}</div>`
                                }
                                <div class="lender-name" style="font-size: 0.75rem; text-align: center; line-height: 1.1; color: #212045;">${lender.name}</div>
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
        
        // Add custom styles for this modal with corporate colors
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            .lenders-modal {
                background: linear-gradient(135deg, rgba(33, 32, 69, 0.9) 0%, rgba(46, 86, 82, 0.9) 100%);
                backdrop-filter: blur(10px);
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }
            @media (max-width: 768px) {
                .lenders-grid {
                    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) !important;
                }
                .lender-option img,
                .lender-option .no-logo-placeholder {
                    width: 70px !important;
                    height: 70px !important;
                }
                .lender-option {
                    min-height: 100px !important;
                }
            }
            @media (max-width: 480px) {
                .lenders-grid {
                    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important;
                }
                .lender-option img,
                .lender-option .no-logo-placeholder {
                    width: 60px !important;
                    height: 60px !important;
                }
                .lender-option {
                    min-height: 90px !important;
                }
            }
            .lender-option:hover {
                border-color: #2E5652 !important;
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(33, 32, 69, 0.15);
                background: linear-gradient(135deg, #ffffff 0%, #E4EEF0 100%) !important;
            }
            .lender-option.selected {
                background: linear-gradient(135deg, #2E5652 0%, #3a6b66 100%) !important;
                border-color: #2E5652 !important;
            }
            .lender-option.selected .lender-name {
                color: white !important;
            }
        `;
        document.head.appendChild(styleTag);
        
        document.body.appendChild(modal);
        
        // Modal functionality
        const selectedLenders = new Set();
        
        // Only close on Cancel button click
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
            styleTag.remove();
        });
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                styleTag.remove();
            }
        });
        
        modal.querySelectorAll('.lender-option').forEach(option => {
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
            modal.querySelectorAll('.lender-option').forEach(option => {
                const name = option.dataset.name.toLowerCase();
                option.style.display = name.includes(search) ? 'flex' : 'none';
            });
        });
        
        modal.querySelector('.modal-save').addEventListener('click', () => {
            selectedLenders.forEach(name => {
                const lender = AppState.lendersList.find(l => l.name === name);
                if (lender && !AppState.additionalLenders.find(l => l.name === name)) {
                    AppState.additionalLenders.push(lender);
                    VisitorTracking.trackManualLender(lender.name || lender.lenderName);

                }
            });

            // Track manual lenders added
            selectedLenders.forEach(name => {
                VisitorTracking.trackManualLender(name);
            });

            modal.remove();
            styleTag.remove();
            this.updateCombinedLendersDisplay();
            Utils.triggerResize();
        });
    },

    updateCombinedLendersDisplay() {
        const combinedList = document.getElementById('combined_lenders_list');
        
        // Clear and repopulate with both found and manual lenders
        combinedList.innerHTML = '';
        
        // Determine total count
        const totalLenders = AppState.foundLenders.length + AppState.additionalLenders.length;
        
        // If only one total lender, use centered layout
        if (totalLenders === 1) {
            combinedList.classList.add('single-lender');
        } else {
            combinedList.classList.remove('single-lender');
        }
        
        // First add found lenders
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
            
            // Date column - FIXED FORMAT
            const dateDiv = document.createElement('div');
            dateDiv.className = 'lender-date';
            if (account.startDate) {
                try {
                    const date = new Date(account.startDate);
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = monthNames[date.getMonth()];
                    const year = String(date.getFullYear()).slice(-2);
                    dateDiv.textContent = `${month} '${year}`;
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
        
        // Then add manually selected lenders with remove X on hover
        AppState.additionalLenders.forEach((lender, index) => {
            const row = document.createElement('div');
            row.className = 'found-row manual-row';
            row.style.position = 'relative'; // For absolute positioning of X
            
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
            
            
            // Add remove X button that appears on hover
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-lender-btn';
            removeBtn.innerHTML = '×';
            removeBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #dc3545;
                color: white;
                border: none;
                font-size: 16px;
                line-height: 1;
                cursor: pointer;
                display: none;
                z-index: 10;
                padding: 0;
                font-weight: bold;
            `;
            
            // Show/hide X on hover
            row.addEventListener('mouseenter', () => {
                removeBtn.style.display = 'block';
            });
            
            row.addEventListener('mouseleave', () => {
                removeBtn.style.display = 'none';
            });
            
            // Remove lender when X is clicked
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Remove from additionalLenders array
                AppState.additionalLenders.splice(index, 1);
                // Refresh the display
                this.updateCombinedLendersDisplay();
            });
            
            row.appendChild(iconDiv);
            row.appendChild(dateDiv);
            row.appendChild(removeBtn);
            combinedList.appendChild(row);
        });
        
        // Update button text based on context
        const addMoreBtn = document.getElementById('add_more_lenders_btn');
        if (addMoreBtn) {
            const btnText = addMoreBtn.querySelector('.btn-text');
            if (btnText) {
                btnText.textContent = 'Add More Lenders';
            }
        }
    },

    // ============= TEST MODE CODE - REMOVE FOR PRODUCTION =============

    initTestMode() {
    const testBtn = document.getElementById('test_mode_btn');
    // If test button doesn't exist (TEST_MODE env var is "no"), exit early
    if (!testBtn) {
        console.log('Test mode is not enabled');
        return;
    }

    testBtn.addEventListener('click', async () => {
        console.warn('🧪 TEST MODE ACTIVATED - Bypassing Valifi');

        const modal        = document.getElementById('test_mode_modal');
        const lendersList  = document.getElementById('test_lenders_list');
        const selectedList = document.getElementById('test_selected_list');
        const searchInput  = document.getElementById('test_lender_search');

        // Selected lenders store
        const selectedLenders = new Map();
        const safeId = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '_');

        try {
        // Fetch lenders (send cookies)
        const response = await fetch('/lenders', { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Normalize payload shape and guarantee a .name field
        const raw = await response.json();
        let lenders = (Array.isArray(raw) ? raw : (raw?.lenders ?? raw?.data ?? []))
            .map(l => ({
            ...l,
            name: l.name || l.display_name || l.flg_name || l.flg_lender_name || '',
            filename: l.filename || ''
            }));

        // Sort alphabetically by normalized name
        lenders.sort((a, b) => a.name.localeCompare(b.name));

        // Renders list with optional text filter
        const displayLenders = (filterText = '') => {
            const q = filterText.toLowerCase();
            const filtered = q
            ? lenders.filter(l => l.name.toLowerCase().includes(q))
            : lenders;

            lendersList.innerHTML = filtered.map(lender => `
            <div style="padding: 5px; border-bottom: 1px solid #eee;">
                <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox"
                        value="${lender.name}"
                        data-filename="${lender.filename}"
                        style="margin-right: 10px;">
                <span>${lender.name}</span>
                </label>
                <div id="date_${safeId(lender.name)}"
                    style="display: none; margin-left: 30px; margin-top: 5px;">
                <label>Start Date:
                    <input type="date"
                        class="test-date-input"
                        data-lender="${lender.name}"
                        value="2019-01-01"
                        style="margin-left: 10px; padding: 4px;">
                </label>
                </div>
            </div>
            `).join('');

            // Checkbox listeners
            lendersList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const lenderName = e.target.value;
                const filename   = e.target.dataset.filename;
                const dateDiv    = document.getElementById(`date_${safeId(lenderName)}`);

                if (e.target.checked) {
                dateDiv.style.display = 'block';
                const dateInput = dateDiv.querySelector('.test-date-input');
                selectedLenders.set(lenderName, {
                    name: lenderName,
                    filename,
                    startDate: dateInput.value
                });
                } else {
                dateDiv.style.display = 'none';
                selectedLenders.delete(lenderName);
                }
                updateSelectedDisplay();
            });
            });

            // Date change listeners
            lendersList.querySelectorAll('.test-date-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const lenderName = e.target.dataset.lender;
                if (selectedLenders.has(lenderName)) {
                selectedLenders.get(lenderName).startDate = e.target.value;
                updateSelectedDisplay();
                }
            });
            });
        };

        // Selected panel renderer
        const updateSelectedDisplay = () => {
            if (selectedLenders.size === 0) {
            selectedList.innerHTML = '<p style="color: #999;">No lenders selected</p>';
            } else {
            selectedList.innerHTML = Array.from(selectedLenders.values()).map(l =>
                `<div style="padding: 5px; background: white; margin: 5px 0; border-radius: 4px;">
                ${l.name} - Start: ${l.startDate}
                </div>`
            ).join('');
            }
        };

        // Search
        searchInput.addEventListener('input', (e) => displayLenders(e.target.value));

        // --- Manual lender entry (not in DB) ---
        (() => {
        // Avoid duplicates if Test Mode is opened more than once
        if (document.getElementById('test_manual_block')) return;

        const manualBlock = document.createElement('div');
        manualBlock.id = 'test_manual_block';
        manualBlock.style.cssText = 'margin:12px 0; padding:10px; background:#f8f8f8; border:1px dashed #ccc; border-radius:6px;';

        manualBlock.innerHTML = `
            <strong>Add custom lender (not in database)</strong>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px;">
            <input id="test_manual_name" type="text" placeholder="Lender name"
                    style="flex:1; min-width:220px; padding:6px;">
            <input id="test_manual_filename" type="text" placeholder="Icon filename (optional)"
                    style="width:220px; padding:6px;">
            <input id="test_manual_date" type="date" style="padding:6px;">
            <button id="test_manual_add" type="button"
                    style="padding:6px 10px; border:0; border-radius:4px; background:#2563eb; color:#fff; cursor:pointer;">
                Add
            </button>
            </div>
            <div id="test_manual_msg" style="margin-top:6px; color:#c00; display:none;"></div>
        `;

        // Place the manual block just above the lenders list
        lendersList.parentNode.insertBefore(manualBlock, lendersList);

        const nameInput   = manualBlock.querySelector('#test_manual_name');
        const fileInput   = manualBlock.querySelector('#test_manual_filename');
        const dateInput   = manualBlock.querySelector('#test_manual_date');
        const addBtn      = manualBlock.querySelector('#test_manual_add');
        const msg         = manualBlock.querySelector('#test_manual_msg');

        // Date defaults: min=2007-01-01, max=today, value=~3 months ago (nice default)
        const today = new Date();
        const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
        const toISO = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
        dateInput.min = '2007-04-06';
        dateInput.max = toISO(today);
        dateInput.value = toISO(threeMonthsAgo);

        const showMsg = (text, ok = false) => {
            msg.style.display = 'block';
            msg.style.color = ok ? '#065f46' : '#c00';
            msg.textContent = text;
            setTimeout(() => { msg.style.display = 'none'; }, 2000);
        };

        const safeId = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '_');

        const addManual = () => {
            const nm = (nameInput.value || '').trim();
            if (!nm) { showMsg('Please enter a lender name'); return; }
            if (selectedLenders.has(nm)) { showMsg('That lender is already selected'); return; }

            // If this custom name also exists in the fetched list, that's fine—we treat it as a separate manual entry.
            selectedLenders.set(nm, {
            name: nm,
            filename: (fileInput.value || '').trim(),
            startDate: dateInput.value
            });

            // Update the right-hand selected panel
            updateSelectedDisplay();

            // Reset inputs & show success
            nameInput.value = '';
            fileInput.value = '';
            dateInput.value = toISO(threeMonthsAgo);
            showMsg('Added ✔', true);
        };

        addBtn.addEventListener('click', addManual);
        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addManual(); });
        })();




        // Initial render
        displayLenders();
        updateSelectedDisplay();

        // Show modal
        modal.style.display = 'block';

        // Cancel
        document.getElementById('test_mode_cancel').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Proceed
        document.getElementById('test_mode_proceed').addEventListener('click', () => {
            if (selectedLenders.size === 0) {
                alert('Please select at least one lender');
                return;
            }

            // Date eligibility checker for test mode
            const checkDateEligibility = (dateStr) => {
                if (!dateStr) return { eligible: true, reason: "No date provided" };
                
                try {
                    const date = new Date(dateStr);
                    const startLimit = new Date('2007-04-06');
                    const endLimit = new Date('2024-11-01');
                    
                    if (date < startLimit) {
                        return { 
                            eligible: false, 
                            reason: `Date ${dateStr} is before eligible period (starts 6 Apr 2007)` 
                        };
                    }
                    
                    if (date > endLimit) {
                        return { 
                            eligible: false, 
                            reason: `Date ${dateStr} is after eligible period (ends 1 Nov 2024)` 
                        };
                    }
                    
                    return { eligible: true, reason: "Date is within eligible range" };
                } catch (e) {
                    return { eligible: false, reason: "Invalid date format" };
                }
            };

            // Fake Valifi response
            const testAccounts = Array.from(selectedLenders.values()).map(lender => {
                const dateCheck = checkDateEligibility(lender.startDate);
                
                return {
                    lenderName: lender.name,
                    displayName: lender.name,
                    logoFile: lender.filename,
                    accountNumber: 'TEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
                    startDate: lender.startDate,
                    currentBalance: Math.floor(Math.random() * 10000) + 1000,
                    monthlyPayment: Math.floor(Math.random() * 500) + 100,
                    dateEligible: dateCheck.eligible,
                    eligibilityReason: dateCheck.reason
                };
            });

            // Set up AppState with test data
            AppState.foundLenders = testAccounts;
            AppState.identityVerified = true;
            AppState.identityScore = 99;

            AppState.flgData = {
                firstName: AppState.formData.first_name || 'Test',
                lastName: AppState.formData.last_name || 'User',
                title: AppState.formData.title || 'Mr',
                dateOfBirth: (() => {
                    const testDate = new Date(AppState.formData.year_slider || 1970, 0, 1);
                    return testDate.toISOString().split('T')[0];
                })(),
                mobile: AppState.formData.mobile || '07777777777',
                email: AppState.formData.email || 'test@example.com',
                address: AppState.addresses.current.display_address || 'Test Address',
                towncity: AppState.addresses.current.post_town || 'Test Town',
                postcode: AppState.addresses.current.post_code || 'TE5 7ED',
                accounts: testAccounts,
                pdfUrl: 'TEST_MODE_NO_PDF',
                previousAddress: AppState.addresses.previous1,
                previousPreviousAddress: AppState.addresses.previous2
            };

            AppState.valifiResponse = { 
                testMode: true, 
                identityScore: 99, 
                data: { accounts: testAccounts } 
            };

            console.log('🧪 Test data created:', { 
                lenders: testAccounts.length, 
                accounts: testAccounts 
            });

            // Hide modal
            modal.style.display = 'none';
            
            // Navigate to step 5
            Navigation.showStep('step5');
            
            // Display lenders
            EventHandlers.displayLenders(testAccounts);

            // Add test mode indicator
            const indicator = document.createElement('div');
            indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #ff6b6b; color: white; padding: 10px; border-radius: 5px; z-index: 9999;';
            indicator.innerHTML = '🧪 TEST MODE ACTIVE';
            document.body.appendChild(indicator);
            
            console.log('Test mode navigation complete');
        });

        
        } catch (error) {
        console.error('Test mode error:', error);
        alert('Failed to load test mode. Check console.');
        }

    });
    },
    
    // ============= END TEST MODE CODE =============



};


// --- Initialize Application ---------------------------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    
    // CRITICAL: Load professional representatives FIRST
    try {
        EventHandlers.loadProfessionalRepresentatives();
        console.log('Professional representatives loaded');
    } catch (error) {
        console.error('Failed to load professional representatives:', error);
    }
    
    // Initialize event handlers
    try {
        EventHandlers.init();
        console.log('EventHandlers initialized successfully');
    } catch (error) {
        console.error('Failed to initialize EventHandlers:', error);
    }
    
    // NEW: Check for resume token BEFORE determining initial step
    const urlParams = new URLSearchParams(window.location.search);
    const resumeToken = urlParams.get('resume') || sessionStorage.getItem('resume_token');
    
    if (resumeToken) {
        console.log('Resume token found:', resumeToken);
        
        // Try to fetch session data
        fetch('/api/resume-session/' + resumeToken)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Session not found');
                }
                return response.json();
            })
            .then(sessionData => {
                if (sessionData && !sessionData.error) {
                    console.log('Loading session data:', sessionData);
                    
                    // Store session info
                    sessionStorage.setItem('session_id', sessionData.session_id);
                    sessionStorage.setItem('resume_token', resumeToken);
                    
                    // Load form data
                    if (sessionData.form_data_snapshot) {
                        try {
                            const formData = JSON.parse(sessionData.form_data_snapshot);
                            AppState.formData = Object.assign(AppState.formData || {}, formData);
                            
                            // Load addresses if present
                            if (formData.current_address) {
                                AppState.addresses = AppState.addresses || {};
                                AppState.addresses.current = formData.current_address;
                            }
                            if (formData.previous_addresses) {
                                if (formData.previous_addresses.previous1) {
                                    AppState.addresses = AppState.addresses || {};
                                    AppState.addresses.previous1 = formData.previous_addresses.previous1;
                                    AppState.previousAddressCount = Math.max(AppState.previousAddressCount || 0, 1);
                                }
                                if (formData.previous_addresses.previous2) {
                                    AppState.addresses = AppState.addresses || {};
                                    AppState.addresses.previous2 = formData.previous_addresses.previous2;
                                    AppState.previousAddressCount = Math.max(AppState.previousAddressCount || 0, 2);
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing form data:', e);
                        }
                    }
                    
                    // Load individual fields from session data
                    if (sessionData.first_name) {
                        AppState.formData.first_name = sessionData.first_name;
                    }
                    if (sessionData.last_name) {
                        AppState.formData.last_name = sessionData.last_name;
                    }
                    if (sessionData.email) {
                        AppState.formData.email = sessionData.email;
                    }
                    if (sessionData.mobile) {
                        AppState.formData.mobile = sessionData.mobile;
                    }
                    if (sessionData.title) {
                        AppState.formData.title = sessionData.title;
                    }
                    
                    // Parse and set date of birth
                    if (sessionData.date_of_birth) {
                        const dob = new Date(sessionData.date_of_birth);
                        AppState.formData.dob_day = dob.getDate().toString();
                        AppState.formData.dob_month = (dob.getMonth() + 1).toString();
                        AppState.formData.dob_year = dob.getFullYear().toString();
                    }
                    
                    // Set current address from session data
                    if (!AppState.addresses) {
                        AppState.addresses = { current: {}, previous1: {}, previous2: {} };
                    }
                    if (sessionData.building_number) {
                        AppState.addresses.current.building_number = sessionData.building_number;
                    }
                    if (sessionData.street) {
                        AppState.addresses.current.street = sessionData.street;
                    }
                    if (sessionData.post_town) {
                        AppState.addresses.current.post_town = sessionData.post_town;
                    }
                    if (sessionData.post_code) {
                        AppState.addresses.current.post_code = sessionData.post_code;
                    }
                    if (sessionData.building_name) {
                        AppState.addresses.current.building_name = sessionData.building_name;
                    }
                    if (sessionData.flat) {
                        AppState.addresses.current.flat = sessionData.flat;
                    }
                    if (sessionData.district) {
                        AppState.addresses.current.district = sessionData.district;
                    }
                    if (sessionData.county) {
                        AppState.addresses.current.county = sessionData.county;
                    }
                    
                    console.log('Session data loaded into AppState');
                    
                    // Navigate to saved step
                    const savedStep = sessionData.last_saved_step || 'step1';
                    console.log('Resuming at step:', savedStep);
                    
                    // Navigate to the saved step
                    Navigation.showStep(savedStep);
                    
                    // Track resume event
                    if (typeof VisitorTracking !== 'undefined') {
                        VisitorTracking.trackDetailedEvent('form_resumed', {
                            resume_token: resumeToken,
                            resumed_step: savedStep,
                            progress: sessionData.form_progress_percent
                        });
                    }
                }
            })
            .catch(error => {
                console.log('Could not fetch resume session:', error);
                // Continue with normal initialization
                initializeNormally();
            });
    } else {
        // No resume token - normal initialization
        initializeNormally();
    }
    
    // Function to handle normal initialization (no resume)
    function initializeNormally() {
        // Determine initial step based on LANDING configuration
        const initialStep = (typeof SHOW_LANDING_PAGE !== 'undefined' && !SHOW_LANDING_PAGE) ? 'step1' : 'step0';
        console.log(`Landing page enabled: ${typeof SHOW_LANDING_PAGE !== 'undefined' ? SHOW_LANDING_PAGE : true}, showing initial step: ${initialStep}`);
        
        // Check if the step is already visible (set by HTML template)
        const initialStepElement = document.getElementById(initialStep);
        const isAlreadyVisible = initialStepElement && 
                                 initialStepElement.classList.contains('active') && 
                                 initialStepElement.style.display !== 'none';
        
        // Start with initial step
        try {
            if (isAlreadyVisible) {
                // Step is already visible from HTML, just update AppState
                console.log(`${initialStep} already visible from HTML, updating AppState only`);
                AppState.currentStep = initialStep;
                AppState.stepStartTime = Date.now();
                
                // Update progress bar if not step0
                if (initialStep !== 'step0') {
                    Navigation.updateProgressBar(initialStep);
                }
            } else {
                // Need to show the step via JavaScript
                Navigation.showStep(initialStep);
                console.log(`Showing ${initialStep} via JavaScript`);
            }
            
            // If landing page is disabled, track that visitor started at step 1
            if (initialStep === 'step1' && typeof VisitorTracking !== 'undefined') {
                VisitorTracking.trackDetailedEvent('landing_skipped', {
                    reason: 'landing_page_disabled',
                    starting_step: 'step1'
                });
            }
        } catch (error) {
            console.error(`Failed to initialize ${initialStep}:`, error);
        }
    }

    // Make fitToIframe available globally for the HTML script to call
    window.fitToIframe = function() {
        const wrapper = document.getElementById('iframeWrapper');
        const root = document.getElementById('scaleRoot');
        
        if (!wrapper || !root) return;
        
        // Reset scale for accurate measurement
        root.style.transform = 'none';
        root.style.width = '100%';
        
        // Calculate available height
        const wrapperStyles = window.getComputedStyle(wrapper);
        const wrapperPadding = parseFloat(wrapperStyles.paddingTop || 0) + parseFloat(wrapperStyles.paddingBottom || 0);
        const available = wrapper.clientHeight - wrapperPadding;
        
        // Measure content height
        const needed = root.scrollHeight;
        
        // Calculate scale (minimum 0.5 for usability)
        const scale = Math.max(0.5, Math.min(1, available / needed));
        
        // Apply scale and adjust width to compensate
        root.style.transformOrigin = 'top center';
        root.style.transform = `scale(${scale})`;
        
        // Adjust width inversely to maintain layout
        if (scale < 1) {
            root.style.width = `${100 / scale}%`;
            wrapper.style.overflowY = 'hidden';
        } else {
            root.style.width = '100%';
            wrapper.style.overflowY = 'hidden';
        }
        
        // Update CSS variable for other elements to use
        document.documentElement.style.setProperty('--iframe-scale', scale);
    };

// Auto-save form fields when users type (added for field population fix)
    document.addEventListener('input', function(e) {
        if (e.target.id && e.target.tagName.match(/INPUT|SELECT|TEXTAREA/)) {
            // Skip previous address fields and non-form fields
            if (!e.target.id.includes('_prev') && !e.target.id.includes('search')) {
                // Save to AppState immediately
                AppState.formData = AppState.formData || {};
                AppState.formData[e.target.id] = e.target.value;
                
                // NEW: Track last active field
                AppState.last_active_field = e.target.id;
                
                // NEW: Increment total interactions counter
                AppState.total_interactions = (AppState.total_interactions || 0) + 1;
                
                console.log('[AUTO-SAVE] Saved', e.target.id, '=', e.target.value);
            }
        }
    });

    // Sync to database when user leaves a field
    document.addEventListener('blur', function(e) {
        if (e.target.id && e.target.tagName.match(/INPUT|SELECT|TEXTAREA/)) {
            if (Navigation && Navigation.saveFormData) {
                Navigation.saveFormData();
                Navigation.syncVisitorData();
                console.log('[AUTO-SAVE] Synced to database');
            }
        }
    }, true);
    
    // NEW: Track tab visibility changes
    document.addEventListener('visibilitychange', function() {
        AppState.tab_visibility_changes = (AppState.tab_visibility_changes || 0) + 1;
        console.log('[TRACKING] Tab visibility changed, count:', AppState.tab_visibility_changes);
    });

});  // This closes the main DOMContentLoaded
