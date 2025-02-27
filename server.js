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
let lastContext = { entity: null, intent: null, data: null, filters: {} };

// Helper to calculate days since a date
function daysSince(dateStr) {
    if (!dateStr) return null;
    const start = new Date(dateStr);
    const now = new Date();
    const diffMs = now - start;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Helper to format date
function formatDate(dateStr) {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString();
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
        // Fetch data from Supabase with detailed logging
        console.log('Fetching salesmen...');
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) {
            console.error('Salesmen fetch error:', salesmenError.message);
            throw new Error('Failed to fetch salesmen: ' + salesmenError.message);
        }
        console.log('Salesmen fetched:', salesmen.length, 'records:', JSON.stringify(salesmen.slice(0, 2))); // Log first 2 for sample

        console.log('Fetching repair_devices...');
        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) {
            console.error('Repair devices fetch error:', repairError.message);
            throw new Error('Failed to fetch repair devices: ' + repairError.message);
        }
        console.log('Repair devices fetched:', repairDevices.length, 'records:', JSON.stringify(repairDevices.slice(0, 2)));

        if ((!salesmen || salesmen.length === 0) && (!repairDevices || repairDevices.length === 0)) {
            res.json({ answer: 'No data found in salesmen or repair_devices tables—check Supabase setup!' });
            return;
        }

        // Intent keywords
        const countKeywords = ['how', 'many', 'number', 'count', 'total'];
        const detailKeywords = ['what', 'where', 'who', 'which', 'is', 'are', 'does', 'has'];
        const durationKeywords = ['how', 'long', 'days', 'time', 'since', 'when'];
        const listKeywords = ['list', 'show', 'tell', 'give', 'all'];
        const existKeywords = ['exist', 'there', 'any', 'some'];
        const compareKeywords = ['more', 'less', 'than', 'compare', 'vs'];
        const isCounting = tokens.some(t => countKeywords.includes(t));
        const isDetail = tokens.some(t => detailKeywords.includes(t)) && !isCounting && !isDuration;
        const isDuration = tokens.some(t => durationKeywords.includes(t)) && !isCounting;
        const isList = tokens.some(t => listKeywords.includes(t));
        const isExist = tokens.some(t => existKeywords.includes(t)) && !isCounting;
        const isCompare = tokens.some(t => compareKeywords.includes(t));
        const isSalesmen = tokens.includes('salesmen') || tokens.includes('salesman');
        const isDevices = tokens.includes('devices') || tokens.includes('device') || tokens.includes('repair');
        const wantsCompany = tokens.includes('company') || tokens.includes('from');
        const wantsBranch = tokens.includes('branch') || tokens.includes('where') || tokens.includes('location');
        const wantsStatus = tokens.includes('status') || tokens.includes('state');
        const refersToIt = tokens.includes('it') || tokens.includes('that');
        const isPrinter = tokens.includes('printer');
        const hasHave = tokens.includes('have') || tokens.includes('has');
        const isNotHave = /not\s+have/i.test(lowerQuestion);
        const wantsName = tokens.includes('name') || tokens.includes('who');
        const wantsSerial = tokens.includes('serial') || tokens.includes('number');
        const wantsDate = tokens.includes('date') || tokens.includes('when') || tokens.includes('added') || tokens.includes('edited') || tokens.includes('received') || tokens.includes('repaired');
        const wantsComments = tokens.includes('comments') || tokens.includes('notes');
        const wantsIssue = tokens.includes('issue') || tokens.includes('problem');
        const wantsDeliveredBy = tokens.includes('delivered') || tokens.includes('by');
        const isFrom = tokens.includes('from') || tokens.includes('in');

        // Entity extraction
        const deviceTypes = ["eda52", "eda51", "eda50", "samsung", "pr3", "zebra"];
        const companies = ["alsad", "alshafiya", "zulal", "sehatik", "rhine", "ramah"];
        const branches = ["asir", "jeddah", "almadinah", "makkah", "riyadh", "dammam", "jizan", "hail", "qassim"];
        const statuses = ["pending", "in progress", "completed"];
        const targetType = deviceTypes.find(t => tokens.includes(t)) || null;
        const targetCompany = companies.find(c => tokens.includes(c)) || null;
        const targetBranchRaw = branches.find(b => tokens.includes(b)) || (tokens.includes('mecca') ? 'makkah' : null);
        const targetBranch = targetBranchRaw || null;
        const targetStatus = statuses.find(s => tokens.includes(s)) || null;
        const targetSerial = tokens.find(t => /^[a-z0-9]{5,}$/.test(t) && !deviceTypes.includes(t) && !companies.includes(t) && !branches.includes(t)) || null;

        // Context determination
        const currentEntity = isSalesmen ? 'salesmen' : isDevices ? 'devices' : lastContext.entity;
        const currentIntent = isCounting ? 'counting' : 
                             isDetail ? 'detail' : 
                             isDuration ? 'duration' : 
                             isList ? 'list' : 
                             isExist ? 'exist' : 
                             isCompare ? 'compare' : 
                             lastContext.intent;

        // Apply filters from context or question
        let filters = { ...lastContext.filters };
        if (targetType) filters.type = targetType;
        if (targetCompany) filters.company = targetCompany;
        if (targetBranch) filters.branch = targetBranch;
        if (targetStatus) filters.status = targetStatus;
        if (targetSerial) filters.serial = targetSerial;
        if (isNotHave && tokens.includes('soti')) filters.soti = false;

        // Filter data
        let filteredSalesmen = salesmen;
        let filteredRepairs = repairDevices;
        if (filters.type) {
            filteredSalesmen = filteredSalesmen.filter(s => 
                (s.device_type && s.device_type.toLowerCase() === filters.type) || 
                (s.printer_type && s.printer_type.toLowerCase() === filters.type));
            filteredRepairs = filteredRepairs.filter(r => 
                (r.device_type && r.device_type.toLowerCase() === filters.type) || 
                (r.printer_type && r.printer_type.toLowerCase() === filters.type));
        }
        if (filters.company) {
            filteredSalesmen = filteredSalesmen.filter(s => s.company && s.company.toLowerCase() === filters.company);
            filteredRepairs = filteredRepairs.filter(r => r.company && r.company.toLowerCase() === filters.company);
        }
        if (filters.branch) {
            filteredSalesmen = filteredSalesmen.filter(s => s.branch && s.branch.toLowerCase() === filters.branch);
            filteredRepairs = filteredRepairs.filter(r => r.branch && r.branch.toLowerCase() === filters.branch);
        }
        if (filters.status) {
            filteredRepairs = filteredRepairs.filter(r => r.status && r.status.toLowerCase() === filters.status);
        }
        if (filters.serial) {
            filteredSalesmen = filteredSalesmen.filter(s => 
                (s.device_serial && s.device_serial.toLowerCase() === filters.serial) || 
                (s.printer_serial && s.printer_serial.toLowerCase() === filters.serial));
            filteredRepairs = filteredRepairs.filter(r => r.serial_number && r.serial_number.toLowerCase() === filters.serial);
        }
        if (filters.soti === false) {
            filteredSalesmen = filteredSalesmen.filter(s => !s.soti);
        }

        // Handle "it" context
        if (refersToIt && lastContext.data) {
            const item = Array.isArray(lastContext.data) && lastContext.data.length === 1 ? lastContext.data[0] : null;
            if (!item) {
                res.json({ answer: `I’m not sure which ${lastContext.entity === 'salesmen' ? 'salesman' : 'device'} you mean—too many options!` });
                return;
            }
            if (lastContext.entity === 'salesmen') {
                if (wantsName) {
                    res.json({ answer: `That salesman’s name is ${item.name || "unknown"}.` });
                    return;
                }
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
                if (wantsSerial) {
                    res.json({ answer: `That salesman’s device serial is ${item.device_serial || "N/A"}, printer serial is ${item.printer_serial || "N/A"}.` });
                    return;
                }
                if (wantsDate) {
                    res.json({ answer: `That salesman was added on ${formatDate(item.added_date)}, edited on ${formatDate(item.edited_date)}.` });
                    return;
                }
                if (wantsComments) {
                    res.json({ answer: `Comments for that salesman: ${item.comments || "none"}.` });
                    return;
                }
                res.json({ answer: `That salesman, ${item.name || "unknown"}, is in ${item.company || "N/A"} ${item.branch || "N/A"}, with device ${item.device_type || "none"} (${item.device_serial || "N/A"}), SOTI ${item.soti ? "enabled" : "disabled"}, added ${formatDate(item.added_date)}.` });
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
                if (wantsSerial) {
                    res.json({ answer: `That device’s serial is ${item.serial_number || "N/A"}.` });
                    return;
                }
                if (wantsDate) {
                    res.json({ answer: `That device was received on ${formatDate(item.received_date)}, repaired on ${formatDate(item.repair_date)}.` });
                    return;
                }
                if (wantsIssue) {
                    res.json({ answer: `That device’s issue is ${item.issue || "unknown"}.` });
                    return;
                }
                if (wantsDeliveredBy) {
                    res.json({ answer: `That device was delivered by ${item.delivered_by || "unknown"}.` });
                    return;
                }
                res.json({ answer: `That device (serial ${item.serial_number || "unknown"}) has status ${item.status || "unknown"}, company ${item.company || "unknown"}, branch ${item.branch || "unknown"}, type ${item.device_type || item.printer_type || "unknown"}, received ${formatDate(item.received_date)}.` });
                return;
            }
        }

        // Counting queries
        if (isCounting || (tokens.includes('about') && lastContext.intent === 'counting')) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                const count = filteredSalesmen.length;
                const answer = `${count} salesm${count === 1 ? 'an' : 'en'}${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                lastContext = { entity: 'salesmen', intent: 'counting', data: filteredSalesmen, filters };
                res.json({ answer });
                return;
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                const count = filteredRepairs.length;
                const answer = `${count} device${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                lastContext = { entity: 'devices', intent: 'counting', data: filteredRepairs, filters };
                res.json({ answer });
                return;
            }
        }

        // Duration queries
        if (isDuration && (isDevices || isRepair || currentEntity === 'devices')) {
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
            lastContext = { entity: 'devices', intent: 'duration', data: filteredRepairs, filters };
            res.json({ answer });
            return;
        }

        // List queries
        if (isList) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                if (filteredSalesmen.length === 0) {
                    const answer = `No salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''} to list.`;
                    res.json({ answer });
                    return;
                }
                const list = filteredSalesmen.map(s => s.name || "unknown").join(", ");
                const answer = `Salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''}: ${list}.`;
                lastContext = { entity: 'salesmen', intent: 'list', data: filteredSalesmen, filters };
                res.json({ answer });
                return;
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                if (filteredRepairs.length === 0) {
                    const answer = `No devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''} to list.`;
                    res.json({ answer });
                    return;
                }
                const list = filteredRepairs.map(r => r.serial_number || "unknown").join(", ");
                const answer = `Devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}: ${list}.`;
                lastContext = { entity: 'devices', intent: 'list', data: filteredRepairs, filters };
                res.json({ answer });
                return;
            }
        }

        // Existence queries
        if (isExist) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                const exists = filteredSalesmen.length > 0;
                const answer = exists 
                    ? `Yes, there are salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''}.`
                    : `No, there aren’t any salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''}.`;
                lastContext = { entity: 'salesmen', intent: 'exist', data: filteredSalesmen, filters };
                res.json({ answer });
                return;
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                const exists = filteredRepairs.length > 0;
                const answer = exists 
                    ? `Yes, there are devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`
                    : `No, there aren’t any devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                lastContext = { entity: 'devices', intent: 'exist', data: filteredRepairs, filters };
                res.json({ answer });
                return;
            }
        }

        // Detail queries
        if (isDetail || (tokens.includes('about') && lastContext.intent === 'counting')) {
            if (isSalesmen || (!isDevices && currentEntity === 'salesmen')) {
                if (filteredSalesmen.length === 0) {
                    const answer = `No salesmen${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${isNotHave && tokens.includes('soti') ? ' without SOTI' : ''}.`;
                    res.json({ answer });
                    return;
                }
                lastContext = { entity: 'salesmen', intent: 'detail', data: filteredSalesmen, filters };
                if (tokens.includes('about') && targetType) {
                    const count = filteredSalesmen.length;
                    const answer = `${count} salesm${count === 1 ? 'an' : 'en'} with ${targetType.toUpperCase()}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                    res.json({ answer });
                    return;
                }
                if (wantsName) {
                    const names = filteredSalesmen.map(s => s.name || "unknown").join(", ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The salesman’s name is ${names}.`
                        : `The salesmen’s names are ${names}.`;
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
                if (wantsSerial) {
                    const serials = filteredSalesmen.map(s => `device: ${s.device_serial || "N/A"}, printer: ${s.printer_serial || "N/A"}`).join("; ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The salesman’s serials are ${serials}.`
                        : `The salesmen’s serials are ${serials}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsDate) {
                    const dates = filteredSalesmen.map(s => `added ${formatDate(s.added_date)}, edited ${formatDate(s.edited_date)}`).join("; ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The salesman’s dates are ${dates}.`
                        : `The salesmen’s dates are ${dates}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsComments) {
                    const comments = filteredSalesmen.map(s => s.comments || "none").join("; ");
                    const answer = filteredSalesmen.length === 1 
                        ? `The salesman’s comments are ${comments}.`
                        : `The salesmen’s comments are ${comments}.`;
                    res.json({ answer });
                    return;
                }
            } else if (isDevices || isRepair || currentEntity === 'devices') {
                if (filteredRepairs.length === 0) {
                    const answer = `No devices in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${targetStatus ? ` with ${targetStatus} status` : ''}.`;
                    res.json({ answer });
                    return;
                }
                lastContext = { entity: 'devices', intent: 'detail', data: filteredRepairs, filters };
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
                if (wantsSerial) {
                    const serials = filteredRepairs.map(r => r.serial_number || "unknown").join(", ");
                    const answer = filteredRepairs.length === 1 
                        ? `The serial of the device in repair is ${serials}.`
                        : `The serials of devices in repair are ${serials}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsDate) {
                    const dates = filteredRepairs.map(r => `received ${formatDate(r.received_date)}, repaired ${formatDate(r.repair_date)}`).join("; ");
                    const answer = filteredRepairs.length === 1 
                        ? `The dates for the device in repair are ${dates}.`
                        : `The dates for devices in repair are ${dates}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsIssue) {
                    const issues = filteredRepairs.map(r => r.issue || "unknown").join("; ");
                    const answer = filteredRepairs.length === 1 
                        ? `The issue with the device in repair is ${issues}.`
                        : `The issues with devices in repair are ${issues}.`;
                    res.json({ answer });
                    return;
                }
                if (wantsDeliveredBy) {
                    const deliveredBy = filteredRepairs.map(r => r.delivered_by || "unknown").join(", ");
                    const answer = filteredRepairs.length === 1 
                        ? `The device in repair was delivered by ${deliveredBy}.`
                        : `The devices in repair were delivered by ${deliveredBy}.`;
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
        const answer = "I’m here to help! Ask about salesmen or repair devices—counts, companies, branches, statuses, dates, or anything else!";
        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Oops, something broke on my end: ' + error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});