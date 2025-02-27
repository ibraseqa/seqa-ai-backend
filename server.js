const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
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

// Hugging Face API setup for RoBERTa
const HF_API_URL = 'https://api-inference.huggingface.co/models/deepset/roberta-base-squad2';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Helper to query Hugging Face RoBERTa API
async function queryRoberta(context, question) {
    try {
        const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    question: question,
                    context: context
                }
            })
        });
        if (!response.ok) {
            throw new Error(`Hugging Face API returned status ${response.status}`);
        }
        const data = await response.json();
        return data.answer || "I couldn’t find an answer—try rephrasing!";
    } catch (error) {
        console.error('RoBERTa Error:', error.message);
        return null; // Null triggers fallback
    }
}

// Helper to format Supabase data as text context
function formatContext(data, type) {
    if (type === 'salesmen') {
        return data.map(s => 
            `${s.name || 'Unknown'} is a salesman in ${s.company || 'N/A'} ${s.branch || 'N/A'} with device ${s.device_type || 'none'} (serial ${s.device_serial || 'N/A'}) and printer ${s.printer_type || 'none'} (serial ${s.printer_serial || 'N/A'}). SOTI is ${s.soti ? 'enabled' : 'disabled'}, verified is ${s.verified ? 'yes' : 'no'}, SalesBuzz is ${s.salesbuzz ? 'yes' : 'no'}.`
        ).join(' ');
    } else if (type === 'repair_devices') {
        return data.map(r => 
            `Device with serial ${r.serial_number || 'N/A'} is in repair, from ${r.company || 'N/A'} ${r.branch || 'N/A'}, status ${r.status || 'N/A'}, type ${r.device_type || r.printer_type || 'N/A'}.`
        ).join(' ');
    }
    return '';
}

// Local fallback for counting
function localCount(data, query) {
    const lowerQuery = query.toLowerCase();
    const isCounting = /(how many|number of|count)/i.test(lowerQuery);
    if (!isCounting) return null;

    let filteredData = data;
    const companies = ["alsad", "alshafiya", "zulal", "sehatik", "rhine", "ramah"];
    const branches = ["asir", "jeddah", "almadinah", "makkah", "riyadh", "dammam", "jizan", "hail", "qassim"];
    const deviceTypes = ["eda52", "eda51", "eda50", "samsung", "pr3", "zebra"];
    const targetCompany = companies.find(c => lowerQuery.includes(c));
    const targetBranch = branches.find(b => lowerQuery.includes(b));
    const targetType = deviceTypes.find(t => lowerQuery.includes(t));

    if (targetCompany) filteredData = filteredData.filter(item => item.company && item.company.toLowerCase() === targetCompany);
    if (targetBranch) filteredData = filteredData.filter(item => item.branch && item.branch.toLowerCase() === targetBranch);
    if (targetType) {
        filteredData = filteredData.filter(item => 
            (item.device_type && item.device_type.toLowerCase() === targetType) || 
            (item.printer_type && item.printer_type.toLowerCase() === targetType));
    }
    if (/not have soti/i.test(lowerQuery) && data[0]?.soti !== undefined) {
        filteredData = filteredData.filter(item => !item.soti);
    }

    return filteredData.length.toString();
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

        // Format contexts
        const salesmenContext = formatContext(salesmen, 'salesmen');
        const repairContext = formatContext(repairDevices, 'repair_devices');

        // Determine which context to use
        const isSalesmen = /salesm(a|e)n/i.test(lowerQuestion);
        const isDevices = /devices|repair/i.test(lowerQuestion);
        let selectedContext, tableName, dataSource;

        if (isSalesmen && !isDevices) {
            selectedContext = salesmenContext;
            tableName = 'salesmen';
            dataSource = salesmen;
        } else if (isDevices || (!isSalesmen && lowerQuestion.includes('repair'))) {
            selectedContext = repairContext;
            tableName = 'repair devices';
            dataSource = repairDevices;
        } else {
            // Try both if unclear
            let answer = await queryRoberta(salesmenContext, question);
            if (answer && !answer.includes("couldn’t") && answer !== question) {
                res.json({ answer });
                return;
            }
            answer = await queryRoberta(repairContext, question);
            if (answer && !answer.includes("couldn’t") && answer !== question) {
                res.json({ answer });
                return;
            }
            // Local fallback for counting
            if (/(how many|number of|count)/i.test(lowerQuestion)) {
                let count = localCount(salesmen, question);
                if (count && count !== "0") {
                    res.json({ answer: `${count} salesmen match that query.` });
                    return;
                }
                count = localCount(repairDevices, question);
                if (count && count !== "0") {
                    res.json({ answer: `${count} devices are in repair.` });
                    return;
                }
            }
            res.json({ answer: "I’m not sure which you mean—salesmen or repair devices? Try being more specific!" });
            return;
        }

        // Query RoBERTa with the selected context
        let answer = await queryRoberta(selectedContext, question);

        // Fallback to local logic if RoBERTa fails
        if (!answer) {
            if (/(how many|number of|count)/i.test(lowerQuestion)) {
                const count = localCount(dataSource, question);
                if (count) {
                    answer = `${count} ${tableName === 'salesmen' ? 'salesmen' : 'devices'} ${tableName === 'repair devices' ? 'are in repair' : 'match that query'}.`;
                } else {
                    answer = `I couldn’t count the ${tableName}—try a different question!`;
                }
            } else {
                answer = `I couldn’t process that about ${tableName}—try rephrasing!`;
            }
        } else if (answer === question || answer.length < 5) {
            answer = `I didn’t quite get that about ${tableName}. Could you rephrase your question?`;
        } else if (/^N\/A$/i.test(answer)) {
            answer = `That info might be missing from the ${tableName} list!`;
        }

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