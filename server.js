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

app.use(express.json({ limit: '10mb' }));

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://beyzsnvccmkztgmltaqs.supabase.co',
    process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJleXpzbnZjY21renRnbWx0YXFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA0NzQ5MzYsImV4cCI6MjA1NjA1MDkzNn0.SmiXJ68HGuHToOdukpVtae2_HBMqd3rf7E7RIK-JInM'
);

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let chatHistory = [];

async function queryOpenAI(context, question) {
    try {
        const messages = [
            { role: 'system', content: `Answer using this JSON data: ${JSON.stringify(context)}. Do not repeat the data in your response.` },
            ...chatHistory.slice(-1),
            { role: 'user', content: question }
        ];

        console.log('Sending to OpenAI with question:', question);
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: messages,
                max_tokens: 75,
                temperature: 0.5
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const answer = data.choices[0].message.content.trim();
        chatHistory = [{ role: 'user', content: question }, { role: 'assistant', content: answer }];
        console.log('OpenAI response:', answer);
        return answer;
    } catch (error) {
        console.error('OpenAI API Error:', error.message);
        return `Sorry, I hit an issue with the AI service: ${error.message}`;
    }
}

app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ answer: 'Please provide a question!' });
    }

    console.log('Received question:', question);

    try {
        console.log('Fetching salesmen data...');
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) {
            console.error('Salesmen fetch error:', salesmenError.message);
            throw new Error(`Failed to fetch salesmen: ${salesmenError.message}`);
        }
        console.log('Salesmen fetched:', salesmen.length);

        console.log('Fetching repair_devices data...');
        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) {
            console.error('Repair devices fetch error:', repairError.message);
            throw new Error(`Failed to fetch repair devices: ${repairError.message}`);
        }
        console.log('Repair devices fetched:', repairDevices.length);

        const context = {
            salesmen: salesmen || [],
            repair_devices: repairDevices || []
        };

        if (context.salesmen.length === 0 && context.repair_devices.length === 0) {
            return res.json({ answer: 'No data available in the system—check Supabase!' });
        }

        const answer = await queryOpenAI(context, question);
        res.json({ answer });

    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({ answer: `Server error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});