(function() {
    'use strict';

    // Configuration and Resource Limits
    const RESOURCE_LIMITS = {
        maxStoredCoins: 500,           // Reduced from 1000
        cleanupInterval: 900000,       // 15 minutes
        updateBatchSize: 5,            // Reduced batch size
        mutationDebounceTime: 500,     // Increased debounce time
        maxDOMCacheEntries: 50,        // Limit DOM cache size
        domCacheTTL: 300000,          // 5 minutes cache TTL
        maxNotificationQueue: 10,      // Limit concurrent notifications
        garbageCollectionInterval: 1800000 // 30 minutes
    };

    let isMonitoring = true;
    let isInitialLoad = true;
    let detectionCount = 0;
    let lastDetectionTime = null;
    let audioElement = null;

    // Enhanced Limited Set with Automatic Cleanup
    class EnhancedLimitedSet {
        constructor(maxSize, cleanupInterval) {
            this.maxSize = maxSize;
            this.items = new Map(); // Store items with timestamps
            this.cleanupInterval = cleanupInterval;
            
            // Run cleanup periodically
            this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
        }

        add(item) {
            if (this.items.size >= this.maxSize) {
                // Remove oldest item
                const [oldestKey] = this.items.keys();
                this.items.delete(oldestKey);
            }
            this.items.set(item, Date.now());
        }

        has(item) {
            return this.items.has(item);
        }

        cleanup() {
            const now = Date.now();
            const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
            
            for (const [item, timestamp] of this.items.entries()) {
                if (now - timestamp > expiryTime) {
                    this.items.delete(item);
                }
            }
        }

        clear() {
            this.items.clear();
            if (this.cleanupTimer) {
                clearInterval(this.cleanupTimer);
            }
        }
    }

    // Improved DOM Cache System
    class DOMCache {
        constructor(maxEntries = RESOURCE_LIMITS.maxDOMCacheEntries, ttl = RESOURCE_LIMITS.domCacheTTL) {
            this.cache = new Map();
            this.maxEntries = maxEntries;
            this.ttl = ttl;
            
            // Periodic cleanup
            setInterval(() => this.cleanup(), 60000);
        }

        set(key, element) {
            if (!element || !document.contains(element)) return;
            
            if (this.cache.size >= this.maxEntries) {
                const [oldestKey] = this.cache.keys();
                this.cache.delete(oldestKey);
            }

            this.cache.set(key, {
                element: element,
                timestamp: Date.now()
            });
        }

        get(key) {
            const entry = this.cache.get(key);
            if (!entry) return null;

            if (!document.contains(entry.element) || 
                Date.now() - entry.timestamp > this.ttl) {
                this.cache.delete(key);
                return null;
            }

            entry.timestamp = Date.now();
            return entry.element;
        }

        cleanup() {
            const now = Date.now();
            for (const [key, entry] of this.cache.entries()) {
                if (!document.contains(entry.element) || 
                    now - entry.timestamp > this.ttl) {
                    this.cache.delete(key);
                }
            }
        }

        clear() {
            this.cache.clear();
        }
    }

    // Memory Monitor
    class MemoryMonitor {
        constructor(warningThreshold = 0.8) {
            this.warningThreshold = warningThreshold;
            this.checkInterval = 60000; // Check every minute
            this.monitor();
        }

        async getMemoryUsage() {
            if ('performance' in window && 'memory' in window.performance) {
                const { usedJSHeapSize, jsHeapSizeLimit } = window.performance.memory;
                return usedJSHeapSize / jsHeapSizeLimit;
            }
            return null;
        }

        async monitor() {
            setInterval(async () => {
                const usage = await this.getMemoryUsage();
                if (usage && usage > this.warningThreshold) {
                    this.triggerCleanup();
                    console.warn(`High memory usage detected: ${(usage * 100).toFixed(1)}%`);
                }
            }, this.checkInterval);
        }

        triggerCleanup() {
            domCache.cleanup();
            seenCoins.cleanup();
            
            if (observer) {
                observer.disconnect();
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }
    }

    // Initialize core components
    const seenCoins = new EnhancedLimitedSet(
        RESOURCE_LIMITS.maxStoredCoins,
        RESOURCE_LIMITS.cleanupInterval
    );
    const domCache = new DOMCache();
    const memoryMonitor = new MemoryMonitor();

    // Optimized debounce function
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function getGraduatedSection() {
        const cached = domCache.get('graduatedSection');
        if (cached) return cached;

        const headers = Array.from(document.querySelectorAll('h2.G3nWYwyOTPi2QhQqDOSG'));
        const graduatedHeader = headers.find(header => header.textContent.includes('Graduated'));
        
        if (!graduatedHeader) return null;
        
        let section = graduatedHeader;
        while (section && !section.classList.contains('IkXVawB0ALMCnMdJvOFY')) {
            section = section.parentElement;
        }

        if (section) {
            domCache.set('graduatedSection', section);
        }
        return section;
    }

    function sendToMonitor(type, data) {
        const message = {
            type: type,
            data: {
                ...data,
                time: data.time ? data.time : new Date().toISOString()
            },
            stats: {
                totalDetections: detectionCount,
                lastDetection: lastDetectionTime,
                startTime: isInitialLoad ? Date.now() : undefined
            }
        };
    
        if (type === 'MONITOR_ENTRY') {
            chrome.runtime.sendMessage({
                type: 'MONITOR_DATA',
                data: message.data,
                stats: message.stats
            });
        } else {
            chrome.runtime.sendMessage(message);
        }
    }

    function showNotification(coinName) {
        if (!isMonitoring || isInitialLoad) return;

        if (!audioElement) {
            audioElement = new Audio(chrome.runtime.getURL('notification.mp3'));
        }
        audioElement.play().catch(e => console.log('Error playing sound:', e));

        if (Notification.permission === "granted") {
            new Notification("New Graduated Coin Detected!", {
                body: `New coin found: ${coinName}`,
                icon: chrome.runtime.getURL('icon48.png')
            });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    showNotification(coinName);
                }
            });
        }
    }

    let processingCoins = false;
    async function checkNewCoins() {
        if (!isMonitoring || processingCoins) return;
        
        processingCoins = true;
        const graduatedSection = getGraduatedSection();
        
        if (graduatedSection) {
            const coins = Array.from(graduatedSection.querySelectorAll('.sBVBv2HePq7qYTpGDmRM'));
            let newCoinsFound = 0;
            
            for (let i = 0; i < coins.length; i += RESOURCE_LIMITS.updateBatchSize) {
                const batch = coins.slice(i, i + RESOURCE_LIMITS.updateBatchSize);
                
                for (const coin of batch) {
                    const addressElement = coin.querySelector('.O1Yy1xXe2uVeuSuj862s');
                    const coinAddress = addressElement?.getAttribute('data-address');
                    
                    if (!coinAddress || seenCoins.has(coinAddress)) continue;

                    const nameElement = coin.querySelector('.siDxb5Gcy0nyxGjDtRQj');
                    const coinName = nameElement?.textContent;
        
                    const descElement = coin.querySelector('.fsYi35goS5HvMls5HBGU');
                    const description = descElement?.textContent;
        
                    if (coinName) {
                        seenCoins.add(coinAddress);
                        showNotification(coinName);
                        
                        detectionCount++;
                        lastDetectionTime = new Date();
        
                        sendToMonitor('MONITOR_ENTRY', {
                            coinName,
                            description,
                            address: coinAddress,
                            
                            time: lastDetectionTime.toISOString(),
                            social: {}
                        });
                        
                        newCoinsFound++;
                        console.log('New graduated coin detected:', coinName, coinAddress);
                    }
                }
                
                // Small delay between batches to prevent blocking
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        processingCoins = false;
    }

    function addMonitoringControls() {
        const cached = domCache.get('monitoringContainer');
        if (cached && document.contains(cached)) return;

        const headers = Array.from(document.querySelectorAll('h2.G3nWYwyOTPi2QhQqDOSG'));
        const graduatedHeader = headers.find(header => header.textContent.includes('Graduated'));
        const headerCol = graduatedHeader?.parentElement;
        
        if (headerCol && !headerCol.querySelector('.monitoring-container')) {
            const monitoringContainer = document.createElement('div');
            monitoringContainer.className = 'monitoring-container';
    
            const monitorLabel = document.createElement('span');
            monitorLabel.className = `monitoring-label ${isMonitoring ? 'active' : 'paused'}`;
            monitorLabel.textContent = '[MONITORING]';
    
            const pauseButton = document.createElement('button');
            pauseButton.className = `pause-button ${isMonitoring ? 'active' : 'paused'}`;
            pauseButton.innerHTML = `
                <span class="status-icon"></span>
                ${isMonitoring ? 'Monitoring' : 'Paused'}
            `;
    
            const monitorButton = document.createElement('button');
            monitorButton.className = 'monitor-button';
            monitorButton.textContent = 'Open Monitor';
            monitorButton.addEventListener('click', () => {
                chrome.runtime.sendMessage({ type: 'OPEN_MONITOR' });
            });
    
            pauseButton.addEventListener('click', () => {
                isMonitoring = !isMonitoring;
                pauseButton.className = `pause-button ${isMonitoring ? 'active' : 'paused'}`;
                pauseButton.innerHTML = `
                    <span class="status-icon"></span>
                    ${isMonitoring ? 'Monitoring' : 'Paused'}
                `;
                monitorLabel.className = `monitoring-label ${isMonitoring ? 'active' : 'paused'}`;
                
                chrome.runtime.sendMessage({ 
                    type: 'UPDATE_MONITORING',
                    data: { isMonitoring }
                });
            });
    
            monitoringContainer.appendChild(monitorLabel);
            monitoringContainer.appendChild(pauseButton);
            monitoringContainer.appendChild(monitorButton);
            
            graduatedHeader.insertAdjacentElement('afterend', monitoringContainer);
            domCache.set('monitoringContainer', monitoringContainer);
        }
    }

    function recordInitialCoins() {
        const graduatedSection = getGraduatedSection();
        if (!graduatedSection) return;

        const coins = graduatedSection.querySelectorAll('.sBVBv2HePq7qYTpGDmRM');
        coins.forEach(coin => {
            const addressElement = coin.querySelector('.O1Yy1xXe2uVeuSuj862s');
            const coinAddress = addressElement?.getAttribute('data-address');
            if (coinAddress) {
                seenCoins.add(coinAddress);
            }
        });
        console.log(`Recorded ${seenCoins.items.size} initial graduated coins`);
    }

    let observer = null;
    function initialize() {
        console.log('Memescope Graduated Monitor initialized');
        
        if (Notification.permission !== "granted") {
            Notification.requestPermission();
        }

        recordInitialCoins();
        addMonitoringControls();
        
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(
            debounce(() => {
                addMonitoringControls();
                checkNewCoins();
            }, RESOURCE_LIMITS.mutationDebounceTime)
        );

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            isInitialLoad = false;
            console.log('Initial load complete, now monitoring for new graduated coins');
        }, 2000);
    }

    function cleanup() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        seenCoins.clear();
        domCache.clear();
        if (audioElement) {
            audioElement.remove();
            audioElement = null;
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UPDATE_MONITORING_STATUS') {
            isMonitoring = message.isMonitoring;
            const pauseButton = document.querySelector('.pause-button');
            const monitorLabel = document.querySelector('.monitoring-label');
            
            if (pauseButton) {
                pauseButton.className = `pause-button ${isMonitoring ? 'active' : 'paused'}`;
                pauseButton.innerHTML = `
                    <span class="status-icon"></span>
                    ${isMonitoring ? 'Monitoring' : 'Paused'}
                `;
            }
            
            if (monitorLabel) {
                monitorLabel.className = `monitoring-label ${isMonitoring ? 'active' : 'paused'}`;
            }
        }
        return true;
    });

    // Visibility change handler
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            domCache.cleanup();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 2000));
    } else {
        setTimeout(initialize, 2000);
    }

    // Optimized interval for checking with batch processing
    const checkInterval = setInterval(() => {
        if (!processingCoins) {  // Only run if not already processing
            addMonitoringControls();
            checkNewCoins();
        }
    }, 3000);

    // Add styles with memory-efficient approach
    const style = document.createElement('style');
    style.textContent = `
        .monitoring-container {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-left: 12px;
            vertical-align: middle;
        }

        .monitoring-label {
            font-size: 14px;
            font-weight: normal;
            transition: color 0.3s ease;
        }

        .monitoring-label.active {
            color: #00ff00;
        }

        .monitoring-label.paused {
            color: #ff0000;
        }

        .pause-button {
            background: #2d2d2d;
            border: 1px solid #444;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: background-color 0.3s ease;
            height: 24px;
            line-height: 1;
        }

        .pause-button:hover {
            background: #3d3d3d;
        }

        .pause-button .status-icon {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: currentColor;
        }

        .pause-button.active {
            color: #00ff00;
        }

        .pause-button.paused {
            color: #ff0000;
        }

        .monitor-button {
            background: #2d2d2d;
            border: 1px solid #444;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 12px;
            height: 24px;
            line-height: 1;
        }

        .monitor-button:hover {
            background: #3d3d3d;
        }
    `;
    document.head.appendChild(style);

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        clearInterval(checkInterval);
        cleanup();
    });
})();