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

// Hugging Face API setup for TAPAS
const HF_API_URL = 'https://api-inference.huggingface.co/models/google/tapas-large-finetuned-wtq';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Helper to query Hugging Face TAPAS API
async function queryTapas(table, query) {
    try {
        const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    table: table,
                    query: query
                }
            })
        });
        if (!response.ok) {
            throw new Error(`Hugging Face API returned status ${response.status}`);
        }
        const data = await response.json();
        return data.answer || "I couldn’t find an answer—try rephrasing!";
    } catch (error) {
        console.error('TAPAS Error:', error.message);
        return "Sorry, I hit a snag with my table reader. Try again or ask differently!";
    }
}

// Helper to convert Supabase data to TAPAS table format
function toTapasTable(data, fields) {
    const headers = fields;
    const rows = data.map(item => fields.map(field => String(item[field] || 'N/A')));
    return { header: headers, rows: rows };
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

        // Define table fields
        const salesmenFields = ['name', 'company', 'branch', 'device_type', 'device_serial', 'printer_type', 'printer_serial', 'soti'];
        const repairFields = ['serial_number', 'company', 'branch', 'status', 'device_type', 'printer_type'];

        // Convert data to TAPAS-compatible tables
        const salesmenTable = toTapasTable(salesmen, salesmenFields);
        const repairTable = toTapasTable(repairDevices, repairFields);

        // Determine which table to query
        const isSalesmen = /salesm(a|e)n/i.test(lowerQuestion);
        const isDevices = /devices|repair/i.test(lowerQuestion);
        let selectedTable, tableName;

        if (isSalesmen && !isDevices) {
            selectedTable = salesmenTable;
            tableName = 'salesmen';
        } else if (isDevices || (!isSalesmen && lowerQuestion.includes('repair'))) {
            selectedTable = repairTable;
            tableName = 'repair devices';
        } else {
            // Try both if unclear
            let answer = await queryTapas(salesmenTable, question);
            if (!answer.includes("couldn’t") && answer !== question) {
                res.json({ answer });
                return;
            }
            answer = await queryTapas(repairTable, question);
            if (!answer.includes("couldn’t") && answer !== question) {
                res.json({ answer });
                return;
            }
            res.json({ answer: "I’m not sure which list you mean—salesmen or repair devices? Try being more specific!" });
            return;
        }

        // Query TAPAS with the selected table
        let answer = await queryTapas(selectedTable, question);

        // Clean up response
        if (answer === question || answer.length < 5) {
            answer = `I didn’t quite get that about ${tableName}. Could you rephrase your question?`;
        } else if (/^N\/A$/i.test(answer)) {
            answer = `I couldn’t find that info in the ${tableName} list—it might be missing!`;
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