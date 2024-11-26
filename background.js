let monitorWindow = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OPEN_MONITOR':
            openMonitorWindow();
            break;
        case 'MONITOR_ENTRY':
            sendToMonitor('MONITOR_DATA', message.data, message.stats);
            break;
        case 'UPDATE_MONITORING':
            updateMonitoringStatus(message.data.isMonitoring);
            // Broadcast the monitoring status to all tabs
            chrome.tabs.query({url: "https://photon-sol.tinyastro.io/en/memescope*"}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'UPDATE_MONITORING_STATUS',
                        isMonitoring: message.data.isMonitoring
                    });
                });
            });
            break;
        case 'TOGGLE_MONITORING':
            // Broadcast the monitoring status to all tabs
            chrome.tabs.query({url: "https://photon-sol.tinyastro.io/en/memescope*"}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'UPDATE_MONITORING_STATUS',
                        isMonitoring: message.isMonitoring
                    });
                });
            });
            // Update monitor window
            sendToMonitor('UPDATE_STATUS', null, null, message.isMonitoring);
            break;
        case 'FETCH_DESCRIPTION':
            fetch(message.url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Origin': 'https://photon-sol.tinyastro.io'
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error('Fetch error:', error);
                sendResponse({ success: false, error: error.toString() });
            });
            return true;
        case 'SEND_TELEGRAM':
            sendTelegramMessage(message.botToken, message.channelId, message.message, message.imageUrl)
                .then(response => {
                    sendResponse({ success: true, data: response });
                })
                .catch(error => {
                    console.error('Telegram error:', error);
                    sendResponse({ success: false, error: error.toString() });
                });
            return true;
    }
});

function openMonitorWindow() {
    if (monitorWindow) {
        chrome.windows.update(monitorWindow.id, { focused: true });
    } else {
        chrome.windows.create({
            url: chrome.runtime.getURL('monitor.html'),
            type: 'popup',
            width: 400,
            height: 600
        }, (window) => {
            monitorWindow = window;
        });
    }
}

function sendToMonitor(type, data, stats, isMonitoring) {
    if (monitorWindow) {
        chrome.runtime.sendMessage({
            type: type,
            data: data,
            stats: stats,
            isMonitoring: isMonitoring
        });
    }
}

function updateMonitoringStatus(isMonitoring) {
    if (monitorWindow) {
        chrome.runtime.sendMessage({
            type: 'UPDATE_STATUS',
            isMonitoring: isMonitoring
        });
    }
}

async function sendTelegramMessage(botToken, channelId, message, imageUrl) {
    try {
        if (imageUrl) {
            // First validate if the image is accessible
            try {
                const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
                if (imageResponse.ok) {
                    // Try sending with image first
                    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            chat_id: channelId,
                            photo: imageUrl,
                            caption: message, // Changed from message.text to message
                            parse_mode: 'MarkdownV2',
                            disable_web_page_preview: false
                        })
                    });

                    const result = await response.json();
                    
                    if (result.ok) {
                        console.log('Successfully sent message with photo');
                        return result;
                    }
                    
                    // If sending with photo fails, log the error and fall back to text
                    console.error('Failed to send photo message:', result.description);
                    return await sendTextOnlyMessage(botToken, channelId, message);
                } else {
                    console.log('Image URL not accessible, falling back to text-only message');
                    return await sendTextOnlyMessage(botToken, channelId, message);
                }
            } catch (imageError) {
                console.error('Error checking image URL:', imageError);
                return await sendTextOnlyMessage(botToken, channelId, message);
            }
        } else {
            return await sendTextOnlyMessage(botToken, channelId, message);
        }
    } catch (error) {
        console.error('Error in sendTelegramMessage:', error);
        // Make one final attempt to send just the text
        try {
            return await sendTextOnlyMessage(botToken, channelId, message);
        } catch (finalError) {
            throw new Error(`Failed to send message: ${finalError.message}`);
        }
    }
}

async function sendTextOnlyMessage(botToken, channelId, message) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: channelId,
            text: message, // Changed from message.text to message
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: false
        })
    });

    const result = await response.json();
    
    if (!result.ok) {
        throw new Error(result.description || 'Failed to send Telegram message');
    }

    return result;
}

chrome.windows.onRemoved.addListener((windowId) => {
    if (monitorWindow && monitorWindow.id === windowId) {
        monitorWindow = null;
    }
});