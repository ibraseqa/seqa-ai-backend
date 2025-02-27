const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch'); // Add this dependency
require('dotenv').config();

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

// Hugging Face API setup
const HF_API_URL = 'https://api-inference.huggingface.co/models/distilgpt2';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Helper to query Hugging Face API
async function queryHuggingFace(prompt) {
    const response = await fetch(HF_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            inputs: prompt,
            parameters: { max_length: 100, temperature: 0.7, top_p: 0.9 }
        })
    });
    const data = await response.json();
    return data[0]?.generated_text || "I couldn’t generate a response—try asking differently!";
}

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Summarize data for context
        const salesmenSummary = `There are ${salesmen.length} salesmen. Example fields: name, company (e.g., ALSAD), branch (e.g., Jeddah), device_type (e.g., EDA52), soti (true/false).`;
        const repairSummary = `There are ${repairDevices.length} devices in repair. Example fields: serial_number, company (e.g., ALSAD), branch (e.g., Jeddah), status (e.g., Pending), device_type (e.g., EDA52), printer_type.`;

        // Compile context
        const context = `${salesmenSummary}\n${repairSummary}\nQuestion: ${question}\nAnswer:`;

        // Call Hugging Face API
        let answer = await queryHuggingFace(context);

        // Clean up response (remove prompt part)
        answer = answer.replace(context, '').trim();

        // Fallback if response is vague
        if (answer.length < 10 || answer.includes("I couldn’t")) {
            answer = "I’m not sure I understood that perfectly. Could you rephrase your question about salesmen or repair devices? I can help with counts, statuses, companies, branches, and more!";
        }

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