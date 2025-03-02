const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Max-Age', '86400'); // Cache CORS for 24 hours
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json({ limit: '10mb' })); // Increase payload limit

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// OpenAI API setup
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Chat history for minimal context
let chatHistory = [];

// Helper to query OpenAI API (gpt-3.5-turbo)
async function queryOpenAI(context, question) {
    try {
        const messages = [
            { role: 'system', content: `Answer the question using this JSON data: ${JSON.stringify(context)}. Do not repeat the data in your response.` },
            ...chatHistory.slice(-1), // Last message only
            { role: 'user', content: question }
        ];

        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: messages,
                max_tokens: 75, // Increased slightly for clarity, still minimal
                temperature: 0.5
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API returned status ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        const answer = data.choices[0].message.content.trim();

        // Update chat history
        chatHistory = [{ role: 'user', content: question }, { role: 'assistant', content: answer }];
        return answer;
    } catch (error) {
        console.error('OpenAI API Error:', error.message);
        return `Error: ${error.message}`;
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
            res.json({ answer: 'No data found—check Supabase!' });
            return;
        }

        // Determine relevant context
        const isSalesmen = /salesm[ae]n|list/i.test(lowerQuestion);
        const isDevices = /device|repair/i.test(lowerQuestion);
        const context = isSalesmen && !isDevices ? { salesmen } : 
                        isDevices && !isSalesmen ? { repair_devices: repairDevices } : 
                        { salesmen, repair_devices };

        // Query OpenAI API
        const answer = await queryOpenAI(context, question);

        // Handle casual greetings
        if (['hi', 'hello', 'hey'].includes(lowerQuestion.trim())) {
            res.json({ answer: "Hi! Ask about salesmen or repair devices." });
            return;
        }

        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Oops, something broke: ' + error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});