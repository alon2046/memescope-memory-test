let isMonitoring = true;

chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
        case 'MONITOR_DATA':
            addMonitorEntry(message.data);
            break;
        case 'UPDATE_STATUS':
            updateMonitoringStatus(message.isMonitoring);
            break;
    }
});

async function fetchDescription(address) {
    try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const response = await chrome.runtime.sendMessage({
            type: 'FETCH_DESCRIPTION',
            url: `https://frontend-api.pump.fun/coins/${address}`
        });

        console.log('API Response for', address, ':', response);

        if (response && response.success && response.data) {
            return response.data;
        } else {
            console.error('Invalid response for', address, ':', response);
            return null;
        }
    } catch (error) {
        console.error('Error fetching description for', address, ':', error);
        return null;
    }
}

function createTwitterSearchUrl(query) {
    return `https://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

async function addMonitorEntry(data) {
    const monitorContent = document.getElementById('monitorContent');
    const entry = document.createElement('div');
    entry.className = 'monitor-entry';
    
    entry.innerHTML = `
        <div class="coin-info">
            <div class="coin-header">
                <div class="coin-name">${data.coinName || 'Unknown'}</div>
                <div class="timestamp">${new Date(data.time).toLocaleTimeString()}</div>
            </div>
            <div class="coin-address">${data.address}</div>
            <div class="loading">Loading coin details...</div>
        </div>
    `;
    
    monitorContent.insertBefore(entry, monitorContent.firstChild);

    try {
        const [coinData, creatorData] = await Promise.all([
            fetchDescription(data.address),
            fetchCreatorHistory(data.creator)
        ]);

        const coinInfo = entry.querySelector('.coin-info');

        if (coinData) {
            let content = `
                <div class="coin-header">
                    <div class="left-section">
                        ${coinData.image_uri ? `<a href="${coinData.image_uri}" target="_blank"><img src="${coinData.image_uri}" class="coin-image" onerror="this.style.display='none'" style="cursor: pointer;"/></a>` : ''}
                        <div class="coin-name">${data.coinName}</div>
                    </div>
                    <div class="timestamp">${new Date(data.time).toLocaleTimeString()}</div>
                </div>
                <div class="coin-address">${data.address}</div>
            `;

            // Add creator history if available
            if (creatorData && creatorData.tokens) {
                content += `
                    <div class="creator-info">
                        <div class="creator-stats">
                            <span>Total Tokens Created: ${creatorData.tokens.length}</span>
                            <a href="https://solscan.io/account/${data.creator}?activity_type=ACTIVITY_SPL_INIT_MINT#defiactivities" 
                               target="_blank" class="creator-link">View Full History</a>
                        </div>
                        <div class="creation-dates">
                            Recent creations: ${creatorData.tokens
                                .slice(0, 3)
                                .map(t => new Date(t.timestamp).toLocaleDateString())
                                .join(', ')}
                        </div>
                    </div>
                `;
            }

            content += `<div class="coin-description">${coinData.description || 'No description available'}</div>`;

            content += `
                <div class="search-buttons">
                    <a href="${createTwitterSearchUrl('$' + data.coinName)}" target="_blank" class="search-button">
                        Search $${data.coinName} on Twitter
                    </a>
                    <a href="${createTwitterSearchUrl(data.address)}" target="_blank" class="search-button">
                        Search Contract on Twitter
                    </a>
                </div>
            `;

            let hasSocials = false;
            let socialsContent = '<div class="coin-socials">';
            
            // add quicklinks
            socialsContent += '<div class="quick-links">';
            socialsContent += `<a href="https://dexscreener.com/solana/${data.address}" target="_blank" class="quick-link">DexScreener</a>`;
            socialsContent += `<a href="https://pump.fun/${data.address}" target="_blank" class="quick-link">Pump.fun</a>`;
            socialsContent += `<a href="https://photon-sol.tinyastro.io/en/r/@cielosol/${data.address}" target="_blank" class="quick-link">Photon</a>`;
            
            // add solscan
            if (coinData.creator) {
                socialsContent += `<a href="https://solscan.io/account/${coinData.creator}" target="_blank" class="quick-link">Creator</a>`;
            }
            socialsContent += '</div>';
            hasSocials = true;
            
            if (coinData.telegram) {
                const telegramUrl = coinData.telegram.startsWith('http') ? coinData.telegram : `https://t.me/${coinData.telegram.replace('@', '')}`;
                socialsContent += `<div>TG: <a href="${telegramUrl}" target="_blank">${coinData.telegram}</a></div>`;
                hasSocials = true;
            }
            if (coinData.twitter) {
                const twitterUrl = coinData.twitter.startsWith('http') ? coinData.twitter : `https://twitter.com/${coinData.twitter.replace('@', '')}`;
                socialsContent += `<div>X: <a href="${twitterUrl}" target="_blank">${coinData.twitter}</a></div>`;
                hasSocials = true;
            }
            if (coinData.website) {
                const websiteUrl = coinData.website.startsWith('http') ? coinData.website : `https://${coinData.website}`;
                socialsContent += `<div>Website: <a href="${websiteUrl}" target="_blank">${coinData.website}</a></div>`;
                hasSocials = true;
            }
            
            socialsContent += '</div>';
            
            if (hasSocials) {
                content += socialsContent;
            }

            coinInfo.innerHTML = content;

            // send tele
            try {
                const settings = await chrome.storage.sync.get(['telegramBotToken', 'telegramChannelId', 'telegramEnabled']);
                
                if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChannelId) {
                    const telegramMessage = formatTelegramMessage(data, coinData);
                    await sendTelegramMessage(settings.telegramBotToken, settings.telegramChannelId, telegramMessage);
                }
            } catch (error) {
                console.error('Error sending Telegram notification:', error);
            }
        } else {
            coinInfo.innerHTML = `
                <div class="coin-header">
                    <div class="coin-name">${data.coinName}</div>
                    <div class="timestamp">${new Date(data.time).toLocaleTimeString()}</div>
                </div>
                <div class="coin-address">${data.address}</div>
                <div class="coin-description">No description available</div>
                <div class="coin-socials">
                    <div class="quick-links">
                        <a href="https://dexscreener.com/solana/${data.address}" target="_blank" class="quick-link">DexScreener</a>
                        <a href="https://pump.fun/${data.address}" target="_blank" class="quick-link">Pump.fun</a>
                        <a href="https://photon-sol.tinyastro.io/en/r/@cielosol/${data.address}" target="_blank" class="quick-link">Photon</a>
                    </div>
                </div>
                <div class="search-buttons">
                    <a href="${createTwitterSearchUrl('$' + data.coinName)}" target="_blank" class="search-button">
                        Search $${data.coinName} on Twitter
                    </a>
                    <a href="${createTwitterSearchUrl(data.address)}" target="_blank" class="search-button">
                        Search Contract on Twitter
                    </a>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error processing coin data:', error);
        entry.querySelector('.loading').textContent = 'Error loading coin details';
    }
}


async function fetchCreatorHistory(creatorAddress) {
    if (!creatorAddress) return null;
    
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'FETCH_CREATOR_HISTORY',
            url: `https://solscan.io/account/${creatorAddress}?activity_type=ACTIVITY_SPL_INIT_MINT#defiactivities`
        });

        if (response && response.success && response.data) {
            return response.data;
        }
        return null;
    } catch (error) {
        console.error('Error fetching creator history:', error);
        return null;
    }
}



function formatTelegramMessage(data, coinData) {
    const escapeMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/([_*\[\]()~`>#+=.|{}\-!:'])/g, '\\$1');
    };

    const formatUrl = (url, type) => {
        if (!url) return '';
        
        // Remove any @ symbol from the start
        url = url.replace(/^@/, '');
        
        // Handle Twitter/X URLs
        if (type === 'twitter') {
            // Remove any existing http/https protocols
            url = url.replace(/https?:\/\/(www\.)?(twitter\.com|x\.com)\//, '');
            // Remove any additional https that might be in the handle
            url = url.replace(/https?:\/\//g, '');
            return `https://twitter.com/${url}`;
        }
        
        // Handle Telegram URLs
        if (type === 'telegram') {
            // Remove any existing telegram protocol/domain
            url = url.replace(/https?:\/\/(www\.)?t\.me\//, '');
            return `https://t.me/${url}`;
        }
        
        // Handle website URLs
        if (type === 'website') {
            if (!url.startsWith('http')) {
                return `https://${url}`;
            }
            return url;
        }
        
        return url;
    };

    try {
        let message = '';
        
        // Basic information
        message += `*Name*\\: ${escapeMarkdown(data.coinName)}\n\n`;
        message += `*Contract*\\:\n\`${data.address}\`\n\n`;
        
        // Description
        if (coinData?.description) {
            const cleanDesc = coinData.description.replace(/[<>]/g, '');
            message += `*Description*\\:\n${escapeMarkdown(cleanDesc)}\n\n`;
        }
        
        // Social Links (if any exist)
        let hasSocials = false;
        if (coinData?.website || coinData?.twitter || coinData?.telegram) {
            message += `*Social Links*\\:\n`;
            
            if (coinData.website) {
                const websiteUrl = formatUrl(coinData.website, 'website');
                message += `Web\\: ${escapeMarkdown(websiteUrl)}\n`;
                hasSocials = true;
            }
            
            if (coinData.twitter) {
                const twitterUrl = formatUrl(coinData.twitter, 'twitter');
                message += `Twitter\\: ${escapeMarkdown(twitterUrl)}\n`;
                hasSocials = true;
            }
            
            if (hasSocials) message += '\n';
        }
        
        // Quick Links with shorter names
        message += `*Links*\\: `;
        message += `[DEX](${escapeMarkdown(`https://dexscreener.com/solana/${data.address}`)}) \\| `;
        message += `[PF](${escapeMarkdown(`https://pump.fun/${data.address}`)}) \\| `;
        message += `[PHOTON](${escapeMarkdown(`https://photon-sol.tinyastro.io/en/r/@cielosol/${data.address}`)})`;

        return {
            text: message,
            imageUrl: coinData?.image_uri
        };
    } catch (error) {
        console.error('Error formatting Telegram message:', error);
        
        // Fallback message if formatting fails
        const fallbackMessage = `New Coin Alert\\!\n\n*Name*\\: ${escapeMarkdown(data.coinName)}\n*Contract*\\: \`${data.address}\``;
        
        return {
            text: fallbackMessage,
            imageUrl: coinData?.image_uri
        };
    }
}

async function sendTelegramMessage(botToken, channelId, message) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'SEND_TELEGRAM',
            botToken: botToken,
            channelId: channelId,
            message: message.text,
            imageUrl: message.imageUrl
        });

        if (!response.success) {
            throw new Error(response.error);
        }
    } catch (error) {
        console.error('Error sending Telegram message:', error);
        throw error;
    }
}





function updateMonitoringStatus(monitoring) {
    isMonitoring = monitoring;
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
        pauseBtn.className = `pause-button ${isMonitoring ? 'active' : 'paused'}`;
        pauseBtn.innerHTML = `
            <span class="status-icon"></span>
            <span class="button-text">${isMonitoring ? 'Monitoring' : 'Paused'}</span>
        `;
    }
}

function initializeSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    const settingsForm = document.getElementById('settingsForm');

    // load saved
    chrome.storage.sync.get(['telegramBotToken', 'telegramChannelId', 'telegramEnabled'], (result) => {
        document.getElementById('botToken').value = result.telegramBotToken || '';
        document.getElementById('channelId').value = result.telegramChannelId || '';
        document.getElementById('telegramEnabled').checked = result.telegramEnabled || false;
    });

    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('active');
    });

    closeSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const botToken = document.getElementById('botToken').value.trim();
        const channelId = document.getElementById('channelId').value.trim();
        const telegramEnabled = document.getElementById('telegramEnabled').checked;

        chrome.storage.sync.set({
            telegramBotToken: botToken,
            telegramChannelId: channelId,
            telegramEnabled: telegramEnabled
        }, () => {
            settingsModal.classList.remove('active');
        });
    });

    // Close model when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });
}

document.getElementById('pauseBtn').addEventListener('click', () => {
    isMonitoring = !isMonitoring;
    chrome.runtime.sendMessage({
        type: 'TOGGLE_MONITORING',
        isMonitoring: isMonitoring
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    document.getElementById('monitorContent').innerHTML = '';
});

// Initialize settings when the page loads
document.addEventListener('DOMContentLoaded', initializeSettings);