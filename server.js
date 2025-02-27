const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nlp = require('compromise');
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

app.use(express.json()); // Allow JSON requests

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Typo correction dictionary
const typoCorrections = {
    "eda25": "EDA52", "eda521": "EDA52", "eda": "EDA52", "eda51": "EDA51", "eda50": "EDA50",
    "samsung": "Samsung", "pr3": "PR3", "zebra": "ZEBRA", "salemen": "salesmen", "salesman": "salesmen",
    "repiar": "repair", "devcies": "devices", "devicse": "devices", "deivces": "devices",
    "numbner": "number", "coutn": "count", "howm": "how", "mnay": "many", "repar": "repair", "repai": "repair",
    "alsad": "ALSAD", "alshafiya": "Alshafiya", "zulal": "Zulal", "sehatik": "Sehatik", "rhine": "Rhine",
    "ramah": "Ramah", "asir": "Asir", "jeddah": "Jeddah", "almadinah": "Almadinah", "makkah": "Makkah",
    "riyadh": "Riyadh", "dammam": "Dammam", "jizan": "Jizan", "hail": "Hail", "qassim": "Qassim",
    "verifed": "verified", "sotti": "soti", "salesbuz": "salesbuzz", "statas": "status", "stats": "status",
    "pendign": "Pending", "inprogess": "In Progress", "comleted": "Completed", "serialnumber": "serial_number",
    "deliveredby": "delivered_by", "recieved": "received", "recived": "received", "issu": "issue",
    "compnay": "company", "brach": "branch", "comp": "company"
};

// Simple context storage (for "it" references)
let lastContext = { type: null, data: null };

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Normalize question with typo corrections
        let words = question.toLowerCase().split(/\s+/).map(word => typoCorrections[word] || word);
        const normalizedQuestion = words.join(" ");
        const doc = nlp(normalizedQuestion);
        console.log('Normalized Question:', normalizedQuestion);

        // Intent detection using compromise
        const isCounting = doc.has('(how many|number of|count)');
        const isListing = doc.has('(list|who|which)');
        const isDetail = doc.has('(what|where|when|is)') && !isCounting && !isListing;
        const isSalesmen = doc.has('salesm(a|e)n');
        const isRepair = doc.has('(repair|repaired|fix|fixing)');
        const wantsBranch = doc.has('branch');
        const wantsCompany = doc.has('company');
        const refersToIt = doc.has('(it|that)');

        // Extract entities
        const deviceTypes = ["EDA52", "EDA51", "EDA50", "Samsung", "PR3", "ZEBRA"];
        const companies = ["ALSAD", "Alshafiya", "Zulal", "Sehatik", "Rhine", "Ramah"];
        const branches = ["Asir", "Jeddah", "Almadinah", "Makkah", "Riyadh", "Dammam", "Jizan", "Hail", "Qassim"];
        const statuses = ["Pending", "In Progress", "Completed"];
        const salesmanFields = ["name", "salesbuzz_code", "company", "branch", "device_type", "device_serial", 
                               "printer_type", "printer_serial", "verified", "soti", "salesbuzz", "added_date", 
                               "edited_date", "comments"];
        const repairFields = ["serial_number", "device_type", "printer_type", "status", "company", "branch", 
                             "delivered_by", "issue", "received_date", "repair_date"];

        const targetType = deviceTypes.find(type => normalizedQuestion.includes(type.toLowerCase())) || null;
        const targetCompany = companies.find(company => normalizedQuestion.includes(company.toLowerCase())) || null;
        const targetBranch = branches.find(branch => normalizedQuestion.includes(branch.toLowerCase())) || null;
        const targetStatus = statuses.find(status => normalizedQuestion.includes(status.toLowerCase())) || null;
        const targetField = [...salesmanFields, ...repairFields].find(field => 
            normalizedQuestion.includes(field.replace("_", " "))
        ) || null;
        let targetValue = null;
        const serialMatch = doc.match('serial number #Value').out('array');
        if (serialMatch.length) {
            targetValue = serialMatch[0].split("serial number")[1].trim();
        } else {
            targetValue = doc.values().not('(serial|number)').out('text') || null;
        }

        // Handle "it" referring to last context
        if (refersToIt && lastContext.type === 'repair' && isDetail) {
            const repair = lastContext.data;
            if (targetField) {
                const value = repair[targetField] || "N/A";
                const answer = `The ${targetField.replace("_", " ")} of that device in repair is ${value}.`;
                res.json({ answer });
                return;
            } else {
                const answer = `That device in repair (serial ${repair.serial_number}) has status ${repair.status}, company ${repair.company}, branch ${repair.branch}, and type ${repair.device_type || repair.printer_type || "N/A"}.`;
                res.json({ answer });
                return;
            }
        }

        // Handle specific detail question: "What is the name of the salesman with device/printer serial number [value]?"
        if (isDetail && doc.has('name') && doc.has('(device|printer) serial') && targetValue) {
            const salesman = salesmen.find(s => 
                s.device_serial.toLowerCase() === targetValue.toLowerCase() || 
                s.printer_serial.toLowerCase() === targetValue.toLowerCase()
            );
            if (salesman) {
                const answer = `The salesman with serial number ${targetValue} is ${salesman.name}.`;
                res.json({ answer });
            } else {
                const answer = `No salesman found with serial number ${targetValue}.`;
                res.json({ answer });
            }
            return;
        } 

        // Handle repair-specific detail questions
        if (isRepair && isDetail) {
            let filteredRepairs = repairDevices;
            if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status.toLowerCase() === targetStatus.toLowerCase());
            if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                r.device_type?.toLowerCase() === targetType.toLowerCase() || 
                r.printer_type?.toLowerCase() === targetType.toLowerCase()
            );
            if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company.toLowerCase() === targetCompany.toLowerCase());
            if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch.toLowerCase() === targetBranch.toLowerCase());
            if (targetValue && targetField === "serial_number") filteredRepairs = filteredRepairs.filter(r => 
                r.serial_number.toLowerCase() === targetValue.toLowerCase()
            );

            if (filteredRepairs.length === 0) {
                let answer = "No devices or printers in repair";
                if (targetStatus) answer += ` with status ${targetStatus}`;
                if (targetType) answer += ` of type ${targetType.toUpperCase()}`;
                if (targetCompany) answer += ` in company ${targetCompany}`;
                if (targetBranch) answer += ` in branch ${targetBranch}`;
                if (targetValue && targetField === "serial_number") answer += ` with serial ${targetValue}`;
                answer += ".";
                res.json({ answer });
                return;
            }

            // Update context for "it"
            if (filteredRepairs.length === 1) {
                lastContext = { type: 'repair', data: filteredRepairs[0] };
            } else {
                lastContext = { type: 'repair', data: filteredRepairs };
            }

            if (wantsBranch && wantsCompany) {
                const results = [...new Set(filteredRepairs.map(r => `${r.company} - ${r.branch}`))].join(", ");
                let answer = targetStatus 
                    ? `${targetStatus} devices in repair are in: ${results}.`
                    : `Devices in repair are in: ${results}.`;
                res.json({ answer });
            } else if (wantsBranch) {
                const branches = [...new Set(filteredRepairs.map(r => r.branch))].join(", ");
                let answer = targetStatus 
                    ? `${targetStatus} devices in repair are in branch(es): ${branches}.`
                    : `Devices in repair are in branch(es): ${branches}.`;
                res.json({ answer });
            } else if (wantsCompany) {
                const companies = [...new Set(filteredRepairs.map(r => r.company))].join(", ");
                let answer = targetStatus 
                    ? `${targetStatus} devices in repair belong to company(ies): ${companies}.`
                    : `Devices in repair belong to company(ies): ${companies}.`;
                res.json({ answer });
            } else if (targetValue && targetField === "serial_number") {
                const repair = filteredRepairs[0];
                if (normalizedQuestion.includes("status")) {
                    const answer = `The status of serial ${repair.serial_number} is ${repair.status}.`;
                    res.json({ answer });
                } else {
                    const answer = `Details for serial ${repair.serial_number}: Status: ${repair.status}, Type: ${repair.device_type || repair.printer_type || "N/A"}, Company: ${repair.company}, Branch: ${repair.branch}, Issue: ${repair.issue}, Received: ${repair.received_date}.`;
                    res.json({ answer });
                }
            } else if (targetField) {
                const value = filteredRepairs.length === 1 ? filteredRepairs[0][targetField] || "N/A" : 
                              [...new Set(filteredRepairs.map(r => r[targetField]))].join(", ");
                const answer = filteredRepairs.length === 1 
                    ? `The ${targetField.replace("_", " ")} of the device in repair is ${value}.`
                    : `The ${targetField.replace("_", " ")} of devices in repair includes: ${value}.`;
                res.json({ answer });
            } else {
                const answer = `I can tell you about branches, companies, or statuses of devices in repair. What exactly would you like to know?`;
                res.json({ answer });
            }
            return;
        }

        // Handle counting questions
        if (isCounting) {
            if (isSalesmen) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => s.device_type === targetType || s.printer_type === targetType);
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch === targetBranch);
                if (targetStatus) filteredSalesmen = filteredSalesmen.filter(s => 
                    (targetStatus === "Pending" && !s.verified && !s.soti && !s.salesbuzz) ||
                    (targetStatus === "In Progress" && (s.verified || s.soti || s.salesbuzz) && !(s.verified && s.soti && s.salesbuzz)) ||
                    (targetStatus === "Completed" && s.verified && s.soti && s.salesbuzz)
                );
                if (targetValue && targetField) filteredSalesmen = filteredSalesmen.filter(s => 
                    String(s[targetField]).toLowerCase().includes(targetValue)
                );
                const count = filteredSalesmen.length;
                const answer = `${count} salesm${count === 1 ? 'an' : 'en'}${targetType ? ` with ${targetType}` : ''}${targetCompany || targetBranch ? " in" : ''}${targetCompany ? ` ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with status ${targetStatus}` : ''}${targetField && targetValue ? ` where ${targetField.replace("_", " ")} is ${targetValue}` : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                lastContext = { type: 'salesmen', data: filteredSalesmen };
                res.json({ answer });
            } else if (isRepair) {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => r.device_type === targetType || r.printer_type === targetType);
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status === targetStatus);
                if (targetValue && targetField) filteredRepairs = filteredRepairs.filter(r => 
                    String(r[targetField]).toLowerCase().includes(targetValue)
                );
                const count = filteredRepairs.length;
                const answer = `${count} device${count === 1 ? '' : 's'}${targetType ? ` (${targetType})` : ''}${targetCompany || targetBranch ? " in" : ''}${targetCompany ? ` ${targetCompany}` : ''}${targetBranch ? ` ${targetBranch}` : ''}${targetStatus ? ` with status ${targetStatus}` : ''}${targetField && targetValue ? ` where ${targetField.replace("_", " ")} is ${targetValue}` : ''} ${count === 1 ? 'is' : 'are'} in repair.`;
                lastContext = { type: 'repair', data: filteredRepairs };
                res.json({ answer });
            } else {
                const answer = "Please specify if you want to count salesmen or repair items.";
                res.json({ answer });
            }
            return;
        } 

        // Handle listing questions
        if (isListing) {
            if (isSalesmen) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => s.device_type === targetType || s.printer_type === targetType);
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch === targetBranch);
                if (targetStatus) filteredSalesmen = filteredSalesmen.filter(s => 
                    (targetStatus === "Pending" && !s.verified && !s.soti && !s.salesbuzz) ||
                    (targetStatus === "In Progress" && (s.verified || s.soti || s.salesbuzz) && !(s.verified && s.soti && s.salesbuzz)) ||
                    (targetStatus === "Completed" && s.verified && s.soti && s.salesbuzz)
                );
                if (targetValue && targetField) filteredSalesmen = filteredSalesmen.filter(s => 
                    String(s[targetField]).toLowerCase().includes(targetValue)
                );
                if (filteredSalesmen.length === 0) {
                    let answer = "No salesmen";
                    if (targetType) answer += ` with ${targetType}`;
                    if (targetCompany || targetBranch) answer += " in";
                    if (targetCompany) answer += ` ${targetCompany}`;
                    if (targetBranch) answer += ` ${targetBranch}`;
                    if (targetStatus) answer += ` with status ${targetStatus}`;
                    if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                    answer += ".";
                    res.json({ answer });
                } else {
                    const names = filteredSalesmen.map(s => s.name).join(", ");
                    let answer = "Salesmen";
                    if (targetType) answer += ` with ${targetType}`;
                    if (targetCompany || targetBranch) answer += " in";
                    if (targetCompany) answer += ` ${targetCompany}`;
                    if (targetBranch) answer += ` ${targetBranch}`;
                    if (targetStatus) answer += ` with status ${targetStatus}`;
                    if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                    answer += `: ${names}.`;
                    lastContext = { type: 'salesmen', data: filteredSalesmen };
                    res.json({ answer });
                }
            } else if (isRepair) {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => r.device_type === targetType || r.printer_type === targetType);
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch === targetBranch);
                if (targetStatus) filteredRepairs = filteredRepairs.filter(r => r.status === targetStatus);
                if (targetValue && targetField) filteredRepairs = filteredRepairs.filter(r => 
                    String(r[targetField]).toLowerCase().includes(targetValue)
                );
                if (filteredRepairs.length === 0) {
                    let answer = "No devices or printers";
                    if (targetType) answer += ` (${targetType})`;
                    if (targetCompany || targetBranch) answer += " in";
                    if (targetCompany) answer += ` ${targetCompany}`;
                    if (targetBranch) answer += ` ${targetBranch}`;
                    if (targetStatus) answer += ` with status ${targetStatus}`;
                    if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                    answer += " are in repair.";
                    res.json({ answer });
                } else {
                    const serials = filteredRepairs.map(r => r.serial_number).join(", ");
                    let answer = "Devices or printers";
                    if (targetType) answer += ` (${targetType})`;
                    if (targetCompany || targetBranch) answer += " in";
                    if (targetCompany) answer += ` ${targetCompany}`;
                    if (targetBranch) answer += ` ${targetBranch}`;
                    if (targetStatus) answer += ` with status ${targetStatus}`;
                    if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                    answer += ` in repair: ${serials}.`;
                    lastContext = { type: 'repair', data: filteredRepairs };
                    res.json({ answer });
                }
            } else {
                const answer = "Please specify if you want to list salesmen or repair items.";
                res.json({ answer });
            }
            return;
        } 

        // Handle other detail questions
        if (isDetail) {
            if (isSalesmen && targetValue) {
                const salesman = salesmen.find(s => s.name.toLowerCase() === targetValue.toLowerCase() || 
                    s.device_serial.toLowerCase() === targetValue.toLowerCase() || 
                    s.printer_serial.toLowerCase() === targetValue.toLowerCase());
                if (salesman) {
                    if (targetField) {
                        const value = salesman[targetField] || "N/A";
                        const answer = `The ${targetField.replace("_", " ")} of ${salesman.name} is ${value}.`;
                        res.json({ answer });
                    } else {
                        const answer = `Details for ${salesman.name}: Company: ${salesman.company}, Branch: ${salesman.branch}, Device: ${salesman.device_type} (${salesman.device_serial}), Printer: ${salesman.printer_type} (${salesman.printer_serial}), Verified: ${salesman.verified ? "Yes" : "No"}, SOTI: ${salesman.soti ? "Yes" : "No"}, SalesBuzz: ${salesman.salesbuzz ? "Yes" : "No"}.`;
                        res.json({ answer });
                    }
                } else {
                    const answer = `No salesman found matching ${targetValue}.`;
                    res.json({ answer });
                }
            } else {
                const answer = "Please provide a name or serial number for salesmen details, or ask about repair devices!";
                res.json({ answer });
            }
            return;
        } 

        // Fallback
        const answer = "I’m here to help! Try asking about salesmen or repair devices—like their company, branch, status, or count.";
        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Something went wrong. Please try again!' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});