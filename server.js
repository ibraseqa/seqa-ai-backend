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

// OpenAI API setup
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Helper to query OpenAI API
async function queryOpenAI(context, question) {
    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo', // Cost-effective, supports your needs
                messages: [
                    { role: 'system', content: 'You are an AI assistant. Use the provided JSON data to answer questions about salesmen and repair devices accurately.' },
                    { role: 'user', content: `Data: ${JSON.stringify(context)}\nQuestion: ${question}` }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API returned status ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenAI API Error:', error.message);
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

        // Query OpenAI API
        const answer = await queryOpenAI(context, question);

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