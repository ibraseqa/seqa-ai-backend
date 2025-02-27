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

// Hugging Face API setup (optional fallback)
const HF_API_URL = 'https://api-inference.huggingface.co/models/distilgpt2';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Helper to query Hugging Face API
async function queryHuggingFace(prompt) {
    try {
        const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: { max_length: 50, temperature: 0.7, top_p: 0.9, return_full_text: false }
            })
        });
        if (!response.ok) throw new Error(`Hugging Face API returned status ${response.status}`);
        const data = await response.json();
        return data[0]?.generated_text || "I couldn’t generate a good answer!";
    } catch (error) {
        console.error('Hugging Face Error:', error.message);
        return null; // Null signals fallback to local logic
    }
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

        // Intent detection with regex
        const isCounting = /(how many|number of|count)/i.test(lowerQuestion);
        const isDetail = /(what|where|is)/i.test(lowerQuestion) && !isCounting;
        const isDevices = /devices/i.test(lowerQuestion);
        const isRepair = /repair/i.test(lowerQuestion);
        const isSalesmen = /salesm(a|e)n/i.test(lowerQuestion);
        const wantsCompany = /company/i.test(lowerQuestion);
        const wantsBranch = /branch/i.test(lowerQuestion);
        const refersToIt = /(it|that)/i.test(lowerQuestion);

        // Simple entity extraction
        const deviceTypes = ["eda52", "eda51", "eda50", "samsung", "pr3", "zebra"];
        const companies = ["alsad", "alshafiya", "zulal", "sehatik", "rhine", "ramah"];
        const branches = ["asir", "jeddah", "almadinah", "makkah", "riyadh", "dammam", "jizan", "hail", "qassim"];
        const targetType = deviceTypes.find(type => lowerQuestion.includes(type)) || null;
        const targetCompany = companies.find(company => lowerQuestion.includes(company)) || null;
        const targetBranch = branches.find(branch => lowerQuestion.includes(branch)) || null;

        // Local logic for common queries
        if (isCounting) {
            if (isDevices && isRepair) {
                let filteredRepairs = repairDevices;
                if (targetType) filteredRepairs = filteredRepairs.filter(r => 
                    (r.device_type && r.device_type.toLowerCase() === targetType) || 
                    (r.printer_type && r.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredRepairs = filteredRepairs.filter(r => r.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredRepairs = filteredRepairs.filter(r => r.branch.toLowerCase() === targetBranch);
                const count = filteredRepairs.length;
                const answer = `${count} device${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} in repair${targetType ? ` (${targetType.toUpperCase()})` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}.`;
                res.json({ answer });
                return;
            } else if (isSalesmen) {
                let filteredSalesmen = salesmen;
                if (targetType) filteredSalesmen = filteredSalesmen.filter(s => 
                    (s.device_type && s.device_type.toLowerCase() === targetType) || 
                    (s.printer_type && s.printer_type.toLowerCase() === targetType));
                if (targetCompany) filteredSalesmen = filteredSalesmen.filter(s => s.company.toLowerCase() === targetCompany);
                if (targetBranch) filteredSalesmen = filteredSalesmen.filter(s => s.branch.toLowerCase() === targetBranch);
                if (/not have soti/i.test(lowerQuestion)) filteredSalesmen = filteredSalesmen.filter(s => !s.soti);
                const count = filteredSalesmen.length;
                const answer = `${count} salesm${count === 1 ? 'an' : 'en'}${targetType ? ` with ${targetType.toUpperCase()}` : ''}${targetCompany ? ` in ${targetCompany}` : ''}${targetBranch ? ` in ${targetBranch}` : ''}${/not have soti/i.test(lowerQuestion) ? ' without SOTI' : ''} ${count === 1 ? 'is' : 'are'} in the list.`;
                res.json({ answer });
                return;
            }
        }

        if (isDetail && isRepair) {
            let filteredRepairs = repairDevices;
            if (refersToIt && filteredRepairs.length > 1) {
                filteredRepairs = filteredRepairs.slice(0, 1); // Assume "it" means the first one for now
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
        }

        // Fallback to Hugging Face API for other queries
        const salesmenSummary = `There are ${salesmen.length} salesmen with fields: name, company (e.g., ALSAD), branch (e.g., Jeddah), device_type (e.g., EDA52), soti (true/false).`;
        const repairSummary = `There are ${repairDevices.length} devices in repair with fields: serial_number, company (e.g., ALSAD), branch (e.g., Jeddah), status (e.g., Pending), device_type (e.g., EDA52), printer_type.`;
        const prompt = `You are a helpful assistant with access to salesmen and repair device data. Answer naturally and concisely based on this context:\n${salesmenSummary}\n${repairSummary}\nQuestion: ${question}\nAnswer:`;
        
        let answer = await queryHuggingFace(prompt);
        if (!answer) {
            answer = "I couldn’t connect to my language model—try asking about counts, companies, or branches!";
        } else {
            answer = answer.trim();
            if (answer.startsWith("Answer:")) answer = answer.replace("Answer:", "").trim();
            const words = answer.split(" ");
            if (words.length > 5 && new Set(words).size < words.length / 2) {
                answer = words.slice(0, 5).join(" ") + "… (I started repeating myself!)";
            }
            if (answer.length < 5 || answer.toLowerCase() === question.toLowerCase()) {
                answer = "I’m not sure I got that—could you rephrase your question about salesmen or repair devices?";
            }
        }

        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Something went wrong on my end. Please try again!' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});