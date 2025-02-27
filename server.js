const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Express app
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Context tracking
let lastContext = { entity: null, intent: null, data: null };

// Helper to calculate days since a date
function daysSince(dateStr) {
    const start = new Date(dateStr);
    const now = new Date();
    const diffMs = now - start;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Helper to normalize text
function normalizeText(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;
    const lowerQuestion = question.toLowerCase();
    const tokens = normalizeText(lowerQuestion);

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Intent keywords
        const countKeywords = ['how', 'many', 'number', 'count', 'total'];
        const detailKeywords = ['what', 'where', 'who', 'which', 'is', 'are', 'does'];
        const durationKeywords = ['how', 'long', 'days', 'time', 'since'];
        const isCounting = tokens.some(t => countKeywords.includes(t));
        const isDetail = tokens.some(t => detailKeywords.includes(t)) && !isCounting;
        const isDuration = tokens.some(t => durationKeywords.includes(t)) && !isCounting;
        const isSalesmen = tokens.includes('salesmen') || tokens.includes('salesman');
        const isDevices = tokens.includes('devices') || tokens.includes('device') || tokens.includes('repair');
        const wantsCompany = tokens.includes('company');
        const wantsBranch = tokens.includes('branch');
        const wantsStatus = tokens.includes('status');
        const refersToIt = tokens.includes('it') || tokens.includes('that');
        const isPrinter = tokens.includes('printer');
        const hasHave = tokens.includes('have') || tokens.includes('has');
        const isNotHave = /not\s+have/i.test(lowerQuestion);

        // Entity extraction
        const deviceTypes = ["eda52", "eda51", "eda50", "samsung", "pr3", "zebra"];
        const companies = ["alsad", "alshafiya", "zulal", "sehatik", "rhine", "ramah"];
        const branches = ["asir", "jeddah", "almadinah", "makkah", "riyadh", "dammam", "jizan", "hail", "qassim"];
        const statuses = ["pending", "in progress", "completed"];
        const targetType = deviceTypes.find(t => tokens.includes(t)) || null;
        const targetCompany = companies.find(c => tokens.includes(c)) || null;
        const targetBranch = branches.find(b => tokens.includes(b)) || null;
        const targetStatus = statuses.find(s => tokens.includes(s)) || null;

        // Context determination
        const currentEntity = isSalesmen ? 'salesmen' : isDevices ? 'devices' : lastContext.entity;
        const currentIntent = isCounting ? 'counting' : isDetail ? 'detail' : isDuration ? 'duration' : lastContext.intent;

        // Handle "it" context
        if (refersToIt && lastContext.data) {
            const item = Array.isArray(lastContext.data) && lastContext.data.length === 1 ? lastContext.data[0] : null;
            if (!item) {
                res.json({ answer: `I’m not sure which ${lastContext.entity === 'salesmen' ? 'salesman' : 'device'} you mean—too many options!` });
                return;
            }
            if (lastContext.entity === 'salesmen') {
                if (wantsCompany) {
                    res.json({ answer: `That salesman’s company is ${item.company || "unknown"}.` });
                    return;
                }
                if (wantsBranch) {
                    res.json({ answer: `That salesman’s branch is ${item.branch || "unknown"}.` });
                    return;
                }
                if (wantsStatus) {
                    const status = item.verified && item.soti && item.salesbuzz ? "Completed" : (item.verified || item.soti || item.salesbuzz) ? "In Progress" : "Pending";
                    res.json({ answer: `That salesman’s status is ${status}.` });
                    return;
                }
                if (isPrinter) {
                    const isItPrinter = item.printer_type && !item.device_type;
                    res.json({ answer: `That salesman’s device is ${isItPrinter ? 'a printer' : 'not a printer'} (type: ${item.printer_type || item.device_type || "none"}).` });
                    return;
                }
                res.json({ answer: `That salesman, ${item.name || "unknown"}, is in ${item.company || "N/A"} ${item.branch || "N/A"}, with device ${item.device_type || "none"} (${item.device_serial || "N/A"}) and SOTI ${item.soti ? "enabled" : "disabled"}.` });
                return;
            } else if (lastContext.entity === 'devices') {
                if (wantsStatus) {
                    res.json({ answer: `That device’s status is ${item.status || "unknown"}.` });
                    return;
                }
                if (wantsCompany) {
                    res.json({ answer: `That device’s company is ${item.company || "unknown"}.` });
                    return;
                }
                if (wantsBranch) {
                    res.json({ answer: `That device’s branch is ${item.branch || "unknown"}.` });
                    return;
                }
                if (isPrinter) {
                    const isItPrinter = item.printer_type && !item.device_type;
                    res.json({ answer: `That device is ${isItPrinter ? 'a printer' : 'not a printer'} (type: ${item.printer_type || item.device_type || "unknown"}).` });
                    return;
                }
                res.json({ answer: `That device (serial ${item.serial_number || "unknown"}) has status ${item.status || "unknown"}, company ${item.company || "unknown"}, branch ${item.branch || "unknown"}, type ${item.device_type || item.printer_type || "unknown"}.` });
                return;
            }
        }

        // Counting queries
        if (isCounting || (tokens.includes('about') && lastContext.intent === 'counting')) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => 
                    (s.device_type && s.device_type.toLowerCase() === targetType) || 
                    (s.printer_type && s.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company && s.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch && s.branch.toLowerCase() === targetBranch);
                if (isNotHave && tokens.includes('soti')) filteredSalesmen = filteredSalesmen.filter(s => !s.soti);
                const count = filteredSalesmen.length;
                const answer = `${count} salesm${count === 1 ? 'an' : 'en'}${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                lastContext = { entity: 'salesmen', intent: 'counting', data: filteredSalesmen };
                res.json({ answer });
                return;
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                    (r.device_type && r.device_type.toLowerCase() === targetType) || 
                    (r.printer_type && r.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company && r.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch && r.branch.toLowerCase() === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status && r.status.toLowerCase() === targetStatus);
                const count = filteredRepairs.length;
                const answer = `${count} device${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                lastContext = { entity: 'devices', intent: 'counting', data: filteredRepairs };
                res.json({ answer });
                return;
            }
        }

        // Duration queries
        if (isDuration && (isDevices || isRepair || currentEntity === 'devices')) {
            let filteredRepairs = repairDevices;
            if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                (r.device_type && r.device_type.toLowerCase() === targetType) || 
                (r.printer_type && r.printer_type.toLowerCase() === targetType));
            if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company && r.company.toLowerCase() === targetCompany);
            if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch && r.branch.toLowerCase() === targetBranch);
            if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status && r.status.toLowerCase() === targetStatus);

            if (filteredRepairs.length === 0) {
                const answer = `No devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''} to check duration for.`;
                res.json({ answer });
                return;
            }

            const days = filteredRepairs.map(r => daysSince(r.received_date)).filter(d => d !== null);
            const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : "unknown";
            const answer = days.length === 1 
                ? `That device has been in repair for ${avgDays} days.`
                : `Devices${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''} have been in repair for an average of ${avgDays} days.`;
            lastContext = { entity: 'devices', intent: 'duration', data: filteredRepairs };
            res.json({ answer });
            return;
        }

        // Detail queries
        if (isDetail || (tokens.includes('about') && lastContext.intent === 'counting')) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => 
                    (s.device_type && s.device_type.toLowerCase() === targetType) || 
                    (s.printer_type && s.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company && s.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch && s.branch.toLowerCase() === targetBranch);
                if (isNotHave && tokens.includes('soti')) filteredSalesmen = filteredSalesmen.filter(s => !s.soti);

                if (filteredSalesmen.length === 0) {
                    const answer = `No salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''}.`;
                    res.json({ answer });
                    return;
                }

                lastContext = { entity: 'salesmen', intent: 'detail', data: filteredSalesmen };

                if (tokens.includes('about') && targetType) {
                    const count = filteredSalesmen.length;
                    const answer = `${count} salesm${count === 1 ? 'an' : 'en'} with ${targetType.toUpperCase()}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                    res.json({ answer });
                    return;
                }
                if (wantsCompany) {
                    const companies = [...new Set(filteredSalesmen.map(s => s.company))].join(", ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The company of the salesman is ${companies}.`
                        : `The companies of salesmen are ${companies}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsBranch) {
                    const branches = [...new Set(filteredSalesmen.map(s => s.branch))].join(", ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The branch of the salesman is ${branches}.`
                        : `The branches of salesmen are ${branches}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsStatus) {
                    const statuses = [...new Set(filteredSalesmen.map(s => 
                        s.verified && s.soti && s.salesbuzz ? "Completed" : (s.verified || s.soti || s.salesbuzz) ? "In Progress" : "Pending"))].join(", ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The status of the salesman is ${statuses}.`
                        : `The statuses of salesmen are ${statuses}.`;
                    res.json({ answer });
                    return;
                }
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                    (r.device_type && r.device_type.toLowerCase() === targetType) || 
                    (r.printer_type && r.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company && r.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch && r.branch.toLowerCase() === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status && r.status.toLowerCase() === targetStatus);

                if (filteredRepairs.length === 0) {
                    const answer = `No devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                    res.json({ answer });
                    return;
                }

                lastContext = { entity: 'devices', intent: 'detail', data: filteredRepairs };

                if (tokens.includes('about') && targetType) {
                    const count = filteredRepairs.length;
                    const answer = `${count} device${count === 1 ? '' : 's'} (${targetType.toUpperCase()})${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''} ${count === 1 ? 'is' : 'are'} in repair.`;
                    res.json({ answer });
                    return;
                }
                if (wantsCompany) {
                    const companies = [...new Set(filteredRepairs.map(r => r.company))].join(", ");
                    const answer = filteredRepairs.length === 1 
                        ? `The company of the device in repair is ${companies}.`
                        : `The companies of devices in repair are ${companies}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsBranch) {
                    const branches = [...new Set(filteredRepairs.map(r => r.branch))].join(", ");
                    const answer = filteredRepairs.length === 1 
                        ? `The branch of the device in repair is ${branches}.`
                        : `The branches of devices in repair are ${branches}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsStatus) {
                    const statuses = [...new Set(filteredRepairs.map(r => r.status))].join(", ");
                    const answer = filteredRepairs.length === 1 
                        ? `The status of the device in repair is ${statuses}.`
                        : `The statuses of devices in repair are ${statuses}.`;
                    res.json({ answer });
                    return;
                }
            }
        }

        // Casual greetings
        if (/hi|hello|hey/i.test(lowerQuestion)) {
            const answer = "Hey there! What’s on your mind about salesmen or repair devices?";
            res.json({ answer });
            return;
        }

        // Fallback
        const answer = "I’m here to help! Try asking about salesmen or repair devices—like how many, their company, branch, status, or how long they’ve been in repair.";
        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Oops, something broke on my end. Try again!' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});