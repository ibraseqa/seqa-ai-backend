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

app.use(express.json()); // Allow JSON requests

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ... rest of your server.js code ...

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
    "compnay": "company", "brach": "branch"
};

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Normalize and correct question
        let words = question.toLowerCase().split(/\s+/).map(word => typoCorrections[word] || word);
        const normalizedQuestion = words.join(" ");
        console.log('Normalized Question:', normalizedQuestion);

        // Intent detection keywords
        const isCounting = words.some(w => ["how", "many", "number", "count"].includes(w)) && !normalizedQuestion.includes("name");
        const isListing = words.some(w => ["list", "who", "which"].includes(w));
        const isDetail = words.some(w => ["what", "where", "when", "is"].includes(w)) && !isCounting && !isListing;
        const isSalesmen = words.some(w => w === "salesmen");
        const isRepair = words.some(w => ["repair", "repaired"].includes(w));
        console.log('Intents - Counting:', isCounting, 'Listing:', isListing, 'Detail:', isDetail, 'Salesmen:', isSalesmen, 'Repair:', isRepair);

        // Field and filter detection
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

        // Extract serial number explicitly
        let targetValue = null;
        const serialIndex = words.indexOf("serial");
        if (serialIndex !== -1 && words[serialIndex + 1] === "number" && serialIndex + 2 < words.length) {
            targetValue = words[serialIndex + 2];
        } else {
            targetValue = words.find(w => !["how", "many", "list", "who", "what", "which", "in", "with", "are", "is", "of", "the", "device", "serial", "number", "printer", "salesmen", "name"]
                .includes(w) && !deviceTypes.includes(w.toUpperCase()) && !companies.includes(w.toUpperCase()) && 
                !branches.includes(w.toUpperCase()) && !statuses.includes(w.toUpperCase()) && 
                !salesmanFields.includes(w.replace(" ", "_")) && !repairFields.includes(w.replace(" ", "_"))) || null;
        }
        console.log('Detected - Type:', targetType, 'Company:', targetCompany, 'Branch:', targetBranch, 'Status:', targetStatus, 'Field:', targetField, 'Value:', targetValue);

        // Handle specific detail question: "What is the name of the salesman with device/printer serial number [value]?"
        if (isDetail && normalizedQuestion.includes("name") && (normalizedQuestion.includes("device serial") || normalizedQuestion.includes("printer serial")) && targetValue) {
            console.log('Entering serial number name lookup...');
            const salesman = salesmen.find(s => 
                s.device_serial.toLowerCase() === targetValue.toLowerCase() || 
                s.printer_serial.toLowerCase() === targetValue.toLowerCase()
            );
            if (salesman) {
                const answer = `The salesman with serial number ${targetValue} is ${salesman.name}.`;
                console.log('Found salesman:', salesman.name);
                res.json({ answer });
            } else {
                const answer = `No salesman found with serial number ${targetValue}.`;
                console.log('No salesman found for serial:', targetValue);
                res.json({ answer });
            }
            return; // Exit early
        } 
        // Handle counting questions
        else if (isCounting) {
            console.log('Entering counting block...');
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
                let answer = `${count} salesmen`;
                if (targetType) answer += ` with ${targetType}`;
                if (targetCompany || targetBranch) answer += " in";
                if (targetCompany) answer += ` ${targetCompany}`;
                if (targetBranch) answer += ` ${targetBranch}`;
                if (targetStatus) answer += ` with status ${targetStatus}`;
                if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                answer += " are in the list.";
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
                let answer = `${count} devices or printers`;
                if (targetType) answer += ` (${targetType})`;
                if (targetCompany || targetBranch) answer += " in";
                if (targetCompany) answer += ` ${targetCompany}`;
                if (targetBranch) answer += ` ${targetBranch}`;
                if (targetStatus) answer += ` with status ${targetStatus}`;
                if (targetField && targetValue) answer += ` where ${targetField.replace("_", " ")} is ${targetValue}`;
                answer += " are in repair.";
                res.json({ answer });
            } else {
                const answer = "Please specify if you want to count salesmen or repair items.";
                res.json({ answer });
            }
        } 
        // Handle listing questions
        else if (isListing) {
            console.log('Entering listing block...');
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
                    res.json({ answer });
                }
            } else {
                const answer = "Please specify if you want to list salesmen or repair items.";
                res.json({ answer });
            }
        } 
        // Handle other detail questions
        else if (isDetail) {
            console.log('Entering other detail block...');
            if (isRepair && targetValue) {
                const repair = repairDevices.find(r => r.serial_number.toLowerCase() === targetValue.toLowerCase());
                if (repair) {
                    if (normalizedQuestion.includes("status")) {
                        const answer = `The status of serial ${repair.serial_number} is ${repair.status}.`;
                        res.json({ answer });
                    } else if (targetField) {
                        const value = repair[targetField] || "N/A";
                        const answer = `The ${targetField.replace("_", " ")} of serial ${repair.serial_number} is ${value}.`;
                        res.json({ answer });
                    } else {
                        const answer = `Details for serial ${repair.serial_number}: Status: ${repair.status}, Type: ${repair.device_type || repair.printer_type || "N/A"}, Company: ${repair.company}, Branch: ${repair.branch}, Issue: ${repair.issue}, Received: ${repair.received_date}.`;
                        res.json({ answer });
                    }
                } else {
                    const answer = `No repair device found with serial ${targetValue}.`;
                    res.json({ answer });
                }
            } else if (isSalesmen && targetValue) {
                const salesman = salesmen.find(s => s.name.toLowerCase() === targetValue.toLowerCase() || s.device_serial.toLowerCase() === targetValue.toLowerCase() || s.printer_serial.toLowerCase() === targetValue.toLowerCase());
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
                const answer = "Please provide a name or serial number to get details.";
                res.json({ answer });
            }
        } 
        // Fallback
        else {
            const answer = "I’m not sure how to answer that. Try asking about counts, lists, or details of salesmen or repair items (e.g., by type, company, branch, status, etc.)!";
            res.json({ answer });
        }

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