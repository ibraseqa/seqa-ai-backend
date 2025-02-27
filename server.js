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
let lastContext = { entity: null, intent: null, data: null }; // entity: 'salesmen'/'devices', intent: 'counting'/'detail'

// Helper to calculate days since a date
function daysSince(dateStr) {
    const start = new Date(dateStr);
    const now = new Date();
    const diffMs = now - start;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;
    const lowerQuestion = question.toLowerCase();

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Intent detection
        const isCounting = /(how many|number of|count|are in)/i.test(lowerQuestion);
        const isDetail = /(what|where|is|which)/i.test(lowerQuestion) && !isCounting;
        const isDuration = /(how long|days|time)/i.test(lowerQuestion);
        const isDevices = /devices/i.test(lowerQuestion);
        const isRepair = /repair/i.test(lowerQuestion);
        const isSalesmen = /salesm(a|e)n/i.test(lowerQuestion);
        const wantsCompany = /company/i.test(lowerQuestion);
        const wantsBranch = /branch/i.test(lowerQuestion);
        const wantsStatus = /status/i.test(lowerQuestion);
        const refersToIt = /(it|that)/i.test(lowerQuestion);
        const isPrinter = /printer/i.test(lowerQuestion);
        const isWhatAbout = /what about/i.test(lowerQuestion);

        // Entity extraction
        const deviceTypes = ["eda52", "eda51", "eda50", "samsung", "pr3", "zebra"];
        const companies = ["alsad", "alshafiya", "zulal", "sehatik", "rhine", "ramah"];
        const branches = ["asir", "jeddah", "almadinah", "makkah", "riyadh", "dammam", "jizan", "hail", "qassim"];
        const statuses = ["pending", "in progress", "completed"];
        const targetType = deviceTypes.find(type => lowerQuestion.includes(type)) || null;
        const targetCompany = companies.find(company => lowerQuestion.includes(company)) || null;
        const targetBranch = branches.find(branch => lowerQuestion.includes(branch)) || null;
        const targetStatus = statuses.find(status => lowerQuestion.includes(status)) || null;

        // Determine entity and intent with context
        const currentEntity = isSalesmen ? 'salesmen' : (isDevices || isRepair) ? 'devices' : lastContext.entity;
        const currentIntent = isCounting ? 'counting' : (isDetail || isWhatAbout) ? 'detail' : isDuration ? 'duration' : lastContext.intent;

        // Handle "it" context
        if (refersToIt && lastContext.data && isDetail) {
            const item = Array.isArray(lastContext.data) && lastContext.data.length === 1 ? lastContext.data[0] : null;
            if (!item) {
                res.json({ answer: `I’m not sure which ${lastContext.entity === 'salesmen' ? 'salesman' : 'device'} you mean—there might be multiple!` });
                return;
            }
            if (lastContext.entity === 'salesmen') {
                if (wantsCompany) {
                    const answer = `The company of that salesman is ${item.company || "unknown"}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsBranch) {
                    const answer = `The branch of that salesman is ${item.branch || "unknown"}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsStatus) {
                    const status = item.verified && item.soti && item.salesbuzz ? "Completed" : (item.verified || item.soti || item.salesbuzz) ? "In Progress" : "Pending";
                    const answer = `The status of that salesman is ${status}.`;
                    res.json({ answer });
                    return;
                }
                const answer = `That salesman, ${item.name}, is in ${item.company || "unknown"} ${item.branch || "unknown"}, with device ${item.device_type || "none"} (${item.device_serial || "none"}) and SOTI ${item.soti ? "enabled" : "disabled"}.`;
                res.json({ answer });
                return;
            } else if (lastContext.entity === 'devices') {
                if (wantsStatus) {
                    const answer = `The status of that device is ${item.status || "unknown"}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsCompany) {
                    const answer = `The company of that device is ${item.company || "unknown"}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsBranch) {
                    const answer = `The branch of that device is ${item.branch || "unknown"}.`;
                    res.json({ answer });
                    return;
                }
                if (isPrinter) {
                    const isItPrinter = item.printer_type && !item.device_type;
                    const answer = `That device is ${isItPrinter ? 'a printer' : 'not a printer'} (type: ${item.printer_type || item.device_type || "unknown"}).`;
                    res.json({ answer });
                    return;
                }
                const answer = `That device (serial ${item.serial_number || "unknown"}) has status ${item.status || "unknown"}, company ${item.company || "unknown"}, branch ${item.branch || "unknown"}, and type ${item.device_type || item.printer_type || "unknown"}.`;
                res.json({ answer });
                return;
            }
        }

        // Counting queries
        if (isCounting || (isWhatAbout && currentIntent === 'counting')) {
            if ((isSalesmen || currentEntity === 'salesmen') && !isRepair) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => 
                    (s.device_type && s.device_type.toLowerCase() === targetType) || 
                    (s.printer_type && s.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch.toLowerCase() === targetBranch);
                if (/not have soti/i.test(lowerQuestion)) filteredSalesmen = filteredSalesmen.filter(s => !s.soti);
                const count = filteredSalesmen.length;
                const answer = `${count} salesm${count === 1 ? 'an' : 'en'}${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${/not have soti/i.test(lowerQuestion) ? ' without SOTI' : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                lastContext = { entity: 'salesmen', intent: 'counting', data: filteredSalesmen };
                res.json({ answer });
                return;
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                    (r.device_type && r.device_type.toLowerCase() === targetType) || 
                    (r.printer_type && r.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch.toLowerCase() === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status.toLowerCase() === targetStatus);
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
            if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company.toLowerCase() === targetCompany);
            if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch.toLowerCase() === targetBranch);
            if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status.toLowerCase() === targetStatus);

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
        if (isDetail || isWhatAbout) {
            if (isDevices && isRepair || currentEntity === 'devices') {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                    (r.device_type && r.device_type.toLowerCase() === targetType) || 
                    (r.printer_type && r.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch.toLowerCase() === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status.toLowerCase() === targetStatus);
                
                if (filteredRepairs.length === 0) {
                    const answer = `No devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                    res.json({ answer });
                    return;
                }

                lastContext = { entity: 'devices', intent: 'detail', data: filteredRepairs };

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
            } else if (isSalesmen || currentEntity === 'salesmen') {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => 
                    (s.device_type && s.device_type.toLowerCase() === targetType) || 
                    (s.printer_type && s.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch.toLowerCase() === targetBranch);
                
                if (filteredSalesmen.length === 0) {
                    const answer = `No salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}.`;
                    res.json({ answer });
                    return;
                }

                lastContext = { entity: 'salesmen', intent: 'detail', data: filteredSalesmen };

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
            }
        }

        // Casual greetings
        if (/hi|hello/i.test(lowerQuestion)) {
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