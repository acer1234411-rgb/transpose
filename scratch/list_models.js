
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY;

async function listModels() {
  try {
    console.log('Using API Key:', apiKey.substring(0, 5) + '...' + apiKey.substring(apiKey.length - 5));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    if (data.models) {
      console.log('Available Models:');
      data.models.forEach(m => console.log(`- ${m.name}`));
    } else {
      console.log('No models found or error:', data);
    }
  } catch (error) {
    console.error('Error listing models:', error);
  }
}

listModels();
