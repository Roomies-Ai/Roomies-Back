export const generateTasksPrompt = (household: any) => {
  const name = household?.name || 'a general household';
  const houseType = household?.houseType?.name || 'House';
  const taskTypes = household?.taskTypes?.map((tt: any) => tt.name).join(', ') || 'General';
  
  const pets = household?.pets?.length 
    ? household.pets.map((p: any) => `a ${p.kind} named ${p.name}`).join(', ') 
    : 'no pets';
  
  return `
            You are a helpful assistant that generates tasks for a household maintenance app.
            Generate a list of tasks for ${name}, which is a ${houseType}.
            The household has the following pets: ${pets}.
            The tasks should be relevant to this specific household. 
            For example, if they have pets, include tasks to feed/walk them.
            The tasks should also include standard weekly tasks like cleaning the house, taking out the trash, etc.
            
            Available Task Categories: ${taskTypes}.
            Assign each task to ONE of these categories.

            Return the tasks in JSON format with the following fields:
            - title: string
            - description: string
            - status: string (pending, in-progress, completed, overdue)
            - points: number (1-10 based on difficulty)
            - taskType: string (Must be one of the categories listed above)
            `;
};

export const generateFairnessPrompt = (task: any, memberStats: any[]) => {
  return `
    You are an AI assistant helping to assign household tasks fairly.
    Task: "${task.title}" (Type: ${task.taskType?.name || 'General'})
    Points for this task: ${task.points}
    
    Here are the household members and their stats:
    ${memberStats.map(s => `- ${s.member.username} (ID: ${s.member.id}): Total Points: ${s.totalPoints}, Times done this task type: ${s.timesDoneThisType}, Prefers this task type: ${s.prefersThisType}`).join('\n')}
    
    Requirements for fairness:
    1. Do NOT penalize members for having too many total points. 
    2. Factor in their preference (if they prefer it, it's a good match).
    3. Factor in their history (if they've done this exact task type many times, maybe give someone else a turn).
    
    Respond in JSON format exactly as an array of objects containing 'userId', 'username', 'reason' (a short explanation why they are recommended), and 'score' (0-100).
  `;
};


export const generateParseTelegramMessagePrompt = (message: string, household: any) => {
  const name = household?.name || 'the household';
  const taskTypes = household?.taskTypes?.map((tt: any) => tt.name).join(', ') || 'General';

  return `
    You are an AI that extracts household tasks from a free-text message.
    Message: "${message}"
    
    Context: This is for ${name}, a ${household?.houseType?.name || 'home'}.
    Available Categories: ${taskTypes}.
    
    Instructions:
    1. Extract a list of distinct tasks mentioned or implied in the message.
    2. Assign a difficulty score (points) from 1 to 10 for each task.
    3. Assign each task to ONE of the Available Categories listed above.
    4. Return ONLY a valid JSON array of task objects with these fields:
       - title: string
       - description: string (brief)
       - points: number
       - status: "pending"
       - taskType: string (Must be one of: ${taskTypes})
  `;
};