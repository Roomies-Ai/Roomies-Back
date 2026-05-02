import { GenerateContentResult, GoogleGenerativeAI } from "@google/generative-ai";

export const promptGemini = async (prompt: string, dynamicModel?: string): Promise<GenerateContentResult> => {
    const apiKeys = process.env.GEMINI_API_KEY?.split(',').map(key => key.trim()).filter(Boolean) || [];
    if (apiKeys.length === 0) {
        throw new Error('GEMINI_API_KEY is not configured in .env');
    }

    // Shuffle keys to distribute load evenly
    const shuffledKeys = [...apiKeys].sort(() => Math.random() - 0.5);

    let lastError: any = null;

    for (const apiKey of shuffledKeys) {
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Models to try for this specific key: [Main/Dynamic Model, Retry Model (optional)]
        const modelsToTry = [dynamicModel || process.env.GEMINI_MODEL || "gemini-2.5-flash"];
        
        // If we're not already using a specific dynamicModel, add the retry model as a fallback for this key
        if (!dynamicModel && process.env.GEMINI_RETRY_MODEL) {
            modelsToTry.push(process.env.GEMINI_RETRY_MODEL);
        }

        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                    }
                });

                const result = await model.generateContent(prompt);
                return result;
            } catch (error: any) {
                lastError = error;
                console.error(`Error from Gemini (Key: ${apiKey.substring(0, 8)}..., Model: ${modelName}):`, error);
                
                // If it's NOT a rate limit (429) or service unavailable (503), 
                // we break the inner loop and move to the next API key.
                if (error.status !== 503 && error.status !== 429) {
                    break; 
                }
                // If it IS 503/429, we continue to the next model for this key, 
                // or if models are exhausted, the outer loop moves to the next key.
            }
        }
    }

    throw new Error(`Failed to get response from Gemini. Error: ${lastError?.status} - ${lastError?.message || 'Unknown error'}`);
};