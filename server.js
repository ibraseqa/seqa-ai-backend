const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

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
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Hugging Face API setup (Mistral-7B)
const HF_API_URL = 'https://api-inference.huggingface.co/models/mixtral-7b-instruct-v0.2';
const HF_API_KEY = process.env.HF_API_KEY || 'your-hf-api-key-here'; // Replace with your HF key

// Helper to query Hugging Face Mistral-7B API
async function queryMistral(context, question) {
    try {
        const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: `Data: ${JSON.stringify(context)}\nQuestion: ${question}`,
                parameters: {
                    max_new_tokens: 150,
                    temperature: 0.7,
                    top_p: 0.9
                }
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Hugging Face API returned status ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        return data[0].generated_text.replace(`Data: ${JSON.stringify(context)}\nQuestion: ${question}`, '').trim();
    } catch (error) {
        console.error('Mistral API Error:', error.message);
        return `Sorry, I hit a snag with the API: ${error.message}. Try again or check the API key!`;
    }
}

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;
    const lowerQuestion = question.toLowerCase();

    try {
        // Fetch data from Supabase
        console.log('Fetching salesmen...');
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);
        console.log('Salesmen fetched:', salesmen.length);

        console.log('Fetching repair_devices...');
        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);
        console.log('Repair devices fetched:', repairDevices.length);

        if ((!salesmen || salesmen.length === 0) && (!repairDevices || repairDevices.length === 0)) {
            res.json({ answer: 'No data in salesmen or repair_devices—check Supabase setup!' });
            return;
        }

        // Combine data into context
        const context = {
            salesmen: salesmen || [],
            repair_devices: repairDevices || []
        };

        // Query Mistral API
        const answer = await queryMistral(context, question);

        // Handle casual greetings
        if (/hi|hello|hey/i.test(lowerQuestion)) {
            res.json({ answer: "Hey there! I’m ready to help with salesmen or repair devices—ask me anything!" });
            return;
        }

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