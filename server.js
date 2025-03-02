const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
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
        const totalSalesmen = context.salesmen.length;
        const alsadCount = context.salesmen.filter(s => s.company === 'ALSAD').length;
        const alsadJeddahCount = context.salesmen.filter(s => s.company === 'ALSAD' && s.branch === 'Jeddah').length;
        const deviceTypes = context.salesmen.reduce((acc, s) => {
            acc[s.device_type] = (acc[s.device_type] || 0) + 1;
            return acc;
        }, {});
        const eda51Count = deviceTypes['EDA51'] || 0;
        const eda52Count = deviceTypes['EDA52'] || 0;

        const messages = [
            { 
                role: 'system', 
                content: `You are a precise assistant. Use this JSON data: ${JSON.stringify(context)}. Total salesmen: ${totalSalesmen}. ALSAD total: ${alsadCount}. ALSAD Jeddah: ${alsadJeddahCount}. Device type counts: EDA51: ${eda51Count}, EDA52: ${eda52Count}. Answer in concise, natural language without repeating the JSON. Use these exact counts where applicable. Maintain context from prior questions—stick to the last mentioned company/branch unless specified otherwise.` 
            },
            ...chatHistory.slice(-4),
            { role: 'user', content: question }
        ];

        console.log('Sending to OpenAI:', { 
            question, 
            total_salesmen: totalSalesmen, 
            alsad: alsadCount, 
            alsad_jeddah: alsadJeddahCount, 
            eda51: eda51Count, 
            eda52: eda52Count 
        });
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
                temperature: 0.3
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const answer = data.choices[0].message.content.trim();
        chatHistory.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
        if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
        console.log('OpenAI response:', answer);
        return answer;
    } catch (error) {
        console.error('OpenAI Error:', error.message);
        return `Sorry, I hit an AI snag: ${error.message}`;
    }
}

app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ answer: 'Please ask a question!' });
    }

    console.log('Received question:', question);

    try {
        console.log('Fetching salesmen...');
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error(`Salesmen fetch failed: ${salesmenError.message}`);
        console.log('Salesmen fetched:', salesmen.length);

        console.log('Fetching repair_devices...');
        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error(`Repair devices fetch failed: ${repairError.message}`);
        console.log('Repair devices fetched:', repairDevices.length);

        const context = {
            salesmen: salesmen || [],
            repair_devices: repairDevices || []
        };

        if (context.salesmen.length === 0 && context.repair_devices.length === 0) {
            return res.json({ answer: 'No data found—check your Supabase tables!' });
        }

        const answer = await queryOpenAI(context, question);
        res.json({ answer });

    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({ answer: `Server issue: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});