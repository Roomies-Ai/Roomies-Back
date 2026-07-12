import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const promptGemini = async (prompt: string, dynamicModel?: string): Promise<GenerateContentResult> => {
    const apiKeys = env.get('GEMINI_API_KEY', { infer: true })?.split(',').map(key => key.trim()).filter(Boolean) || [];
    if (apiKeys.length === 0) {
        throw new Error('GEMINI_API_KEY is not configured in .env');
    }

    const shuffledKeys = [...apiKeys].sort(() => Math.random() - 0.5);
    let lastError: any = null;

    for (const apiKey of shuffledKeys) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiRetryModel = env.get('GEMINI_RETRY_MODEL', { infer: true });
        const modelsToTry = [dynamicModel || env.get('GEMINI_MODEL', { infer: true }) || "gemini-2.5-flash"];

        if (!dynamicModel && geminiRetryModel) {
            modelsToTry.push(geminiRetryModel);
        }

        for (const modelName of modelsToTry) {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            responseMimeType: "application/json",
                        }
                    });

                    return await model.generateContent(prompt);
                } catch (error: any) {
                    lastError = error;
                    attempts++;

                    if (error.status === 503 && attempts < maxAttempts) {
                        const delay = Math.floor(Math.random() * 3000) + (1000 * attempts);
                        console.warn(`[Gemini 503] Service Unavailable. Retrying attempt ${attempts}/${maxAttempts} in ${delay}ms...`);
                        await sleep(delay);
                        continue;
                    }

                    console.error(`Error from Gemini (Key: ${apiKey.substring(0, 8)}..., Model: ${modelName}):`, error);
                    
                    // If not a 503 (or max retries reached), or if it's not a 429, we might want to switch keys
                    if (error.status !== 503 && error.status !== 429) {
                        break; 
                    }
                    // For 429 or exhausted 503 retries, we'll break this while loop and move to next model/key
                    break;
                }
            }
            
            // If the error was something critical (not 503/429), break model loop to switch API keys
            if (lastError && lastError.status !== 503 && lastError.status !== 429) {
                break;
            }
        }
    }

    throw new Error(`Failed to get response from Gemini. Error: ${lastError?.status} - ${lastError?.message || 'Unknown error'}`);
};