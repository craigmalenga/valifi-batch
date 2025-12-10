const CookieConsent = {
    hasConsent() {
        return localStorage.getItem('tracking_consent') === 'true';
    },
    
    setConsent(value) {
        localStorage.setItem('tracking_consent', value ? 'true' : 'false');
        if (value) {
            window.dispatchEvent(new Event('cookie_consent_given'));
        }
    },
    
    waitForConsent() {
        return new Promise((resolve) => {
            // Check if already consented
            if (this.hasConsent()) {
                resolve(true);
                return;
            }
            
            // Listen for consent event from your consent banner
            window.addEventListener('cookie_consent_given', () => {
                resolve(true);
            });
        });
    }
};


const VisitorTracking = {
    
    sessionId: null,
    visitorId: null,
    startTime: Date.now(),
    stepStartTimes: {},
    fieldFocusTimes: {},
    inactivityTimer: null,
    lastActivityTime: Date.now(),
    scrollTracking: {},
    
    async init() {  // Note: added "async" keyword
        // ======================================================================
        // TEMPORARY: Cookie consent gate disabled until cookie banner is live.
        // When a proper banner calls CookieConsent.setConsent(true/false),
        // restore the consent gate below to respect user choice.
        // ======================================================================
        /*
        const hasConsent = CookieConsent.hasConsent();
        if (!hasConsent) {
            console.log('Waiting for tracking consent...');
            window.addEventListener('cookie_consent_given', () => {
                this.init();  // Re-run init when consent given
            });
            return;  // Exit for now
        }
        */
        
        // Generate or retrieve IDs up-front so all tracking has a session context
        this.sessionId = this.getOrCreateSessionId();
        this.visitorId = this.getOrCreateVisitorId();
        
        if (!this.sessionId || !this.visitorId) {
            console.error('VisitorTracking.init: missing session or visitor ID; tracking disabled for this page view.', {
                sessionId: this.sessionId,
                visitorId: this.visitorId
            });
            return;
        }
        
        // Capture tracking data on page load (UTMs, referrer, FB/Google params, etc.)
        this.captureInitialData();
        
        // Track engagement metrics
        this.trackEngagement();
        this.trackScrollDepth();
        this.trackInactivity();
        this.trackTabVisibility();
        
        // Track form interactions if AppState exists
        if (typeof AppState !== 'undefined') {
            this.trackFormInteractions();
            this.initializeStepTracking();
        }
        
        // Send initial page view event into the detailed tracking pipeline
        this.trackDetailedEvent('page_view', {
            page: window.location.pathname,
            title: document.title
        });
    },

    
    getOrCreateSessionId() {
        // Check sessionStorage for existing session_id (persists within tab)
        let sessionId = sessionStorage.getItem('session_id');
        if (!sessionId) {
            // Generate new UUID v4 compatible format (matches backend validation)
            sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            sessionStorage.setItem('session_id', sessionId);
            console.log('VisitorTracking: created new session_id', sessionId);
        } else {
            // existing session
            // console.log('VisitorTracking: using existing session_id', sessionId);
        }
        return sessionId;
    },
    
    getOrCreateVisitorId() {
        let visitorId = this.getCookie('visitor_id');
        if (!visitorId) {
            // Generate UUID v4 compatible format (matches backend validation)
            visitorId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            this.setCookie('visitor_id', visitorId, 365);
            console.log('VisitorTracking: created new visitor_id', visitorId);
        } else {
            // console.log('VisitorTracking: using existing visitor_id', visitorId);
        }
        return visitorId;
    },
    
    initializeStepTracking() {
        // Track step transitions
        if (typeof Navigation !== 'undefined' && typeof Navigation.showStep === 'function') {
            const originalShowStep = Navigation.showStep;
            const self = this;
            
            Navigation.showStep = (stepName) => {
                try {
                    // Adjust step tracking if landing page is disabled
                    let fromStep = AppState.currentStep;
                    
                    // If landing page is disabled and this is the first step, mark as if coming from step0
                    if (typeof SHOW_LANDING_PAGE !== 'undefined' && !SHOW_LANDING_PAGE && !fromStep && stepName === 'step1') {
                        fromStep = 'step0_skipped';
                    }
                    
                    self.trackStepTransition(fromStep, stepName);
                } catch (e) {
                    console.error('VisitorTracking.initializeStepTracking: error tracking step transition', e);
                }
                
                // Always call original implementation
                originalShowStep.call(Navigation, stepName);
            };
        }
    },
    
    trackStepTransition(fromStep, toStep) {
        try {
            // Track time spent on previous step
            if (fromStep && this.stepStartTimes[fromStep]) {
                const timeSpent = Math.round((Date.now() - this.stepStartTimes[fromStep]) / 1000);
                this.trackDetailedEvent('step_complete', {
                    step_name: fromStep,
                    time_spent: timeSpent,
                    next_step: toStep
                });
            }
            
            // Start timing new step
            this.stepStartTimes[toStep] = Date.now();
            this.trackDetailedEvent('step_view', {
                step_name: toStep,
                previous_step: fromStep
            });
        } catch (e) {
            console.error('VisitorTracking.trackStepTransition: error', e, { fromStep, toStep });
        }
    },
    
    trackFormInteractions() {
        // Track all input field interactions
        document.addEventListener('focusin', (e) => {
            try {
                if (e.target.matches('input, select, textarea')) {
                    const fieldName = e.target.name || e.target.id || e.target.type;
                    this.fieldFocusTimes[fieldName] = Date.now();
                    this.trackDetailedEvent('field_interaction', {
                        field_name: fieldName,
                        field_type: e.target.type,
                        current_step: AppState?.currentStep
                    });
                }
            } catch (err) {
                console.error('VisitorTracking.trackFormInteractions focusin error:', err);
            }
        });
        
        document.addEventListener('focusout', (e) => {
            try {
                if (e.target.matches('input, select, textarea')) {
                    const fieldName = e.target.name || e.target.id || e.target.type;
                    const timeSpent = this.fieldFocusTimes[fieldName] ? 
                        Math.round((Date.now() - this.fieldFocusTimes[fieldName]) / 1000) : 0;
                    
                    // Check if field has value (completed)
                    const hasValue = e.target.value && e.target.value.trim() !== '';
                    if (hasValue) {
                        this.trackDetailedEvent('field_complete', {
                            field_name: fieldName,
                            time_spent: timeSpent,
                            current_step: AppState?.currentStep
                        });
                    }
                }
            } catch (err) {
                console.error('VisitorTracking.trackFormInteractions focusout error:', err);
            }
        });
        
        // Track checkbox changes (consents)
        document.addEventListener('change', (e) => {
            try {
                if (e.target.type === 'checkbox') {
                    const checkboxId = e.target.id || e.target.name;
                    let consentType = 'unknown';
                    
                    // Map checkbox IDs to consent types
                    if (checkboxId.includes('motor') || checkboxId === 'motorFinanceConsent') {
                        consentType = 'motor_finance';
                    } else if (checkboxId.includes('irl') || checkboxId === 'irresponsibleLendingConsent') {
                        consentType = 'irresponsible_lending';
                    } else if (checkboxId.includes('consent')) {
                        consentType = checkboxId.replace('_checkbox', '').replace('Consent', '');
                    } else if (checkboxId.includes('terms')) {
                        consentType = 'terms';
                    } else if (checkboxId.includes('credit')) {
                        consentType = 'credit_check';
                    }
                    
                    this.trackDetailedEvent('consent_change', {
                        consent_type: consentType,
                        consent_value: e.target.checked,
                        checkbox_id: checkboxId,
                        current_step: AppState?.currentStep
                    });
                }
            } catch (err) {
                console.error('VisitorTracking.trackFormInteractions change error:', err);
            }
        });
        
        // Track validation errors
        document.addEventListener('invalid', (e) => {
            try {
                const fieldName = e.target.name || e.target.id || e.target.type;
                this.trackDetailedEvent('field_validation_error', {
                    field_name: fieldName,
                    validation_message: e.target.validationMessage,
                    current_step: AppState?.currentStep
                });
            } catch (err) {
                console.error('VisitorTracking.trackFormInteractions invalid error:', err);
            }
        }, true);
    },
    
    trackScrollDepth() {
        let maxScroll = 0;
        let scrollTimer = null;
        
        window.addEventListener('scroll', () => {
            try {
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(() => {
                    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
                    const scrollPercent = scrollHeight > 0 ? 
                        Math.round((window.pageYOffset / scrollHeight) * 100) : 100;
                    
                    if (scrollPercent > maxScroll) {
                        maxScroll = scrollPercent;
                        const currentStep = AppState?.currentStep || 'page';
                        
                        this.trackDetailedEvent('scroll_depth', {
                            step_name: currentStep,
                            depth: scrollPercent
                        });
                    }
                }, 500);
            } catch (err) {
                console.error('VisitorTracking.trackScrollDepth error:', err);
            }
        });
    },
    
    trackInactivity() {
        const INACTIVITY_THRESHOLD = 30000; // 30 seconds
        
        const resetInactivityTimer = () => {
            try {
                if (this.inactivityTimer) {
                    clearTimeout(this.inactivityTimer);
                }
                
                const timeSinceLastActivity = Date.now() - this.lastActivityTime;
                if (timeSinceLastActivity > INACTIVITY_THRESHOLD) {
                    this.trackDetailedEvent('inactive_period', {
                        duration: Math.round(timeSinceLastActivity / 1000),
                        current_step: AppState?.currentStep
                    });
                }
                
                this.lastActivityTime = Date.now();
                
                this.inactivityTimer = setTimeout(() => {
                    this.trackDetailedEvent('inactive_period', {
                        duration: INACTIVITY_THRESHOLD / 1000,
                        current_step: AppState?.currentStep
                    });
                }, INACTIVITY_THRESHOLD);
            } catch (err) {
                console.error('VisitorTracking.trackInactivity error:', err);
            }
        };
        
        ['mousedown', 'keypress', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, resetInactivityTimer);
        });
        
        resetInactivityTimer();
    },
    
    trackTabVisibility() {
        document.addEventListener('visibilitychange', () => {
            try {
                this.trackDetailedEvent('tab_visibility_change', {
                    visible: !document.hidden,
                    current_step: AppState?.currentStep
                });
            } catch (err) {
                console.error('VisitorTracking.trackTabVisibility error:', err);
            }
        });
    },
    
    // Track specific journey milestones
    trackIdentityVerification(status) {
        this.trackDetailedEvent('identity_verification', {
            status: status,
            current_step: AppState?.currentStep
        });
    },
    
    trackOTPStatus(status) {
        this.trackDetailedEvent('otp_status', {
            status: status, // 'sent' or 'verified'
            current_step: AppState?.currentStep
        });
    },
    
    trackCreditCheck(status, additionalData = {}) {
        this.trackDetailedEvent('credit_check', {
            status: status, // 'initiated', 'completed', 'stored'
            ...additionalData,
            current_step: AppState?.currentStep
        });
    },
    
    trackSignature(status) {
        this.trackDetailedEvent('signature', {
            status: status, // 'provided'
            current_step: AppState?.currentStep
        });
    },
    
    trackTerms(action) {
        this.trackDetailedEvent('terms', {
            action: action, // 'scrolled_to_bottom' or 'accepted'
            current_step: AppState?.currentStep
        });
    },
    
    trackProfessionalRep(selectedReps, disengagementReason = null) {
        this.trackDetailedEvent('professional_rep', {
            selected_reps: selectedReps,
            disengagement_reason: disengagementReason,
            current_step: AppState?.currentStep
        });
    },
    
    trackFCADisclosure(action, data = {}) {
        this.trackDetailedEvent('fca_disclosure', {
            action: action, // 'viewed' or 'choice_selected'
            ...data,
            current_step: AppState?.currentStep
        });
    },
    
    trackManualLender(lenderName) {
        this.trackDetailedEvent('manual_lender', {
            lender_name: lenderName,
            current_step: AppState?.currentStep
        });
    },
    
    // Main tracking function – centralised entry point for all detailed events
    trackDetailedEvent(eventType, data = {}) {
        if (!this.sessionId || !this.visitorId) {
            console.warn('trackDetailedEvent called without valid session/visitor IDs', {
                eventType,
                hasSession: !!this.sessionId,
                hasVisitor: !!this.visitorId
            });
            return;
        }
        if (!eventType) {
            console.warn('trackDetailedEvent called without eventType');
            return;
        }
        const payload = {
            session_id: this.sessionId,
            visitor_id: this.visitorId,
            event_type: eventType,
            timestamp: new Date().toISOString(),
            ...data
        };
        
        // Queue events and send in batches for performance
        this.queueEvent(payload);
    },
    
    eventQueue: [],
    queueTimer: null,
    
    queueEvent(event) {
        this.eventQueue.push(event);
        
        // Send immediately for critical events
        const criticalEvents = [
            'credit_check', 'identity_verification', 'signature', 
            'form_complete', 'conversion', 'step_complete'
        ];
        
        if (criticalEvents.includes(event.event_type)) {
            this.flushEventQueue();
        } else {
            // Batch non-critical events
            if (!this.queueTimer) {
                this.queueTimer = setTimeout(() => this.flushEventQueue(), 5000);
            }
        }
    },
    
    async flushEventQueue() {
        if (this.eventQueue.length === 0) return;
        
        const events = [...this.eventQueue];
        this.eventQueue = [];
        
        clearTimeout(this.queueTimer);
        this.queueTimer = null;
        
        try {
            // Send individual events or bulk depending on count
            if (events.length === 1) {
                await this.sendToBackend('/tracking/track-detailed-event', events[0]);
            } else {
                await this.sendToBackend('/tracking/track-bulk-events', {
                    session_id: this.sessionId,
                    events: events
                });
            }
        } catch (error) {
            console.error('Failed to send tracking events:', error);
            // Re-queue events on failure
            this.eventQueue = [...events, ...this.eventQueue];
        }
    },
    
    // Original tracking methods (keep for backward compatibility)
    captureInitialData() {
        try {
            // Prevent duplicate initial tracking
            if (this.initialDataSent) {
                console.log('Initial tracking already sent, skipping');
                return;
            }
            this.initialDataSent = true;
            
            const urlParams = new URLSearchParams(window.location.search);
            
            const trackingData = {
                session_id: this.sessionId,
                visitor_id: this.visitorId,
                
                // Standard UTM parameters
                source: urlParams.get('utm_source') || this.detectSource(),
                medium: urlParams.get('utm_medium') || '',
                term: urlParams.get('utm_term') || '',
                campaign: urlParams.get('utm_campaign') || '',
                content: urlParams.get('utm_content') || '',
                
                // Facebook specific parameters
                fb_campaign_id: urlParams.get('fb_campaign_id') || urlParams.get('campaign_id') || '',
                fb_adset_id: urlParams.get('fb_adset_id') || urlParams.get('adset_id') || '',
                fb_ad_id: urlParams.get('fb_ad_id') || urlParams.get('ad_id') || '',
                fb_placement: urlParams.get('fb_placement') || urlParams.get('placement') || '',
                fb_platform: urlParams.get('fb_platform') || urlParams.get('site_source_name') || '',
                fb_campaign_name: urlParams.get('fb_campaign_name') || '',
                fb_adset_name: urlParams.get('fb_adset_name') || '',
                fb_ad_name: urlParams.get('fb_ad_name') || '',
                
                // Google specific
                gclid: urlParams.get('gclid') || '',
                google_keyword: urlParams.get('keyword') || '',
                
                // Page data
                landing_page: window.location.href,
                referrer: document.referrer
            };
            
            // Send initial tracking data
            this.sendToBackend('/tracking/track-visitor', trackingData);
        } catch (err) {
            console.error('VisitorTracking.captureInitialData error:', err);
            // Don't rethrow - tracking failure shouldn't break the app
        }
    },
    
    trackFormEvent(eventType, formStage = '') {
        // Enhanced form event tracking – used for high-level form lifecycle events
        if (!this.sessionId || !this.visitorId) {
            console.warn('trackFormEvent called without valid session/visitor IDs', {
                eventType,
                formStage,
                hasSession: !!this.sessionId,
                hasVisitor: !!this.visitorId
            });
            return;
        }
        if (!eventType) {
            console.warn('trackFormEvent called without eventType');
            return;
        }
        const data = {
            session_id: this.sessionId,
            visitor_id: this.visitorId,
            event_type: eventType,
            form_stage: formStage,
            timestamp: new Date().toISOString()
        };
        
        this.sendToBackend('/tracking/track-form-event', data);
    },
    
    async sendToBackend(endpoint, data) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                console.error(`Tracking request failed: ${response.status}`, { endpoint, data });
            }
            
            return response.json();
        } catch (error) {
            console.error('Tracking error:', error, { endpoint, data });
        }
    },
    
    detectSource() {
        const referrer = document.referrer;
        if (!referrer) return 'direct';
        
        if (referrer.includes('facebook.com') || referrer.includes('fb.com')) return 'facebook';
        if (referrer.includes('google.')) return 'google';
        if (referrer.includes('bing.com')) return 'bing';
        if (referrer.includes('linkedin.com')) return 'linkedin';
        
        return 'referral';
    },
    
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    },
    
    setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
    },
    
    trackEngagement() {
        // Track before user leaves
        window.addEventListener('beforeunload', () => {
            try {
                this.flushEventQueue();
            } catch (err) {
                console.error('VisitorTracking.trackEngagement beforeunload error:', err);
            }
        });
    }
};


// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VisitorTracking.init());
} else {
    VisitorTracking.init();
}


window.VisitorTracking = VisitorTracking;