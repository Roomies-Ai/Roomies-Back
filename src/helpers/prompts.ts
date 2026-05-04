export const generateTasksPrompt = (household: any) => {
  const name = household?.name || 'a general household';
  const houseType = household?.houseType?.name || 'House';
  const taskTypes = household?.taskTypes?.map((tt: any) => tt.name).join(', ') || 'General';
  
  const pets = household?.pets?.length 
    ? household.pets.map((p: any) => `${p.kind} (${p.name})`).join(', ') 
    : 'no pets';
  
  return `
    Act as a "Proactive Household Management Expert". Your goal is to generate a comprehensive, realistic, and highly relevant list of tasks for "${name}", which is a ${houseType}.

    Household Context:
    - Pets: ${pets}
    - Available Categories: ${taskTypes}

    Task Generation Guidelines:
    1. Granularity & Decomposition: NEVER generate broad, generic tasks. If a task is complex (e.g., "Clean Kitchen"), you MUST break it down into multiple smaller, highly specific tasks (e.g., "Wipe kitchen counters", "Clean the stovetop", "Mop the kitchen floor").
    2. Diversity: Include a mix of daily essentials, maintenance, and pet care.
    3. Specificity: All titles must be action-oriented and clear.
    4. Point Logic (1-10 Scale): 
       - 1-3: Quick tasks (<10 mins), e.g., feeding pets, taking out trash.
       - 4-7: Moderate effort (30-60 mins), e.g., mopping floors, cleaning a bathroom.
       - 8-10: High effort/Time-consuming (>1.5 hours). Prefer breaking these into multiple 4-7 point tasks instead.
    5. Categorization: You MUST assign each task to exactly ONE of these categories: ${taskTypes}.

    Output Requirements:
    Return a JSON array of objects with these EXACT fields:
    - title: String (concise, action-oriented)
    - description: String (brief context or helpful tip)
    - status: "pending"
    - points: Number (based on the effort guidelines above)
    - taskType: String (MUST be from the provided list)
  `;
};

export const generateFairnessPrompt = (task: any, memberStats: any[]) => {
  return `
    You are the "Fairness and Harmony Orchestrator" for a shared household. Your objective is to recommend the best member to handle a specific task based on historical data and preferences.

    Current Task: "${task.title}" (Category: ${task.taskType?.name || 'General'})
    Complexity/Points: ${task.points}
    
    Member Statistics & Preferences:
    ${memberStats.map(s => `- ${s.member.username} (ID: ${s.member.id}): 
      * Total Impact Points: ${s.totalPoints}
      * Experience with this type: ${s.timesDoneThisType} times
      * Preference: ${s.prefersThisType ? 'LOVES this category' : 'Neutral/No preference'}`).join('\n')}
    
    Decision Criteria:
    1. Preference Over Points: If someone loves a task type, they should be a top candidate even if they have more points than others.
    2. Rotation: If a member has done this specific task type significantly more than others, lower their priority to prevent burnout, unless they strongly prefer it.
    3. Workload Balance: Favor members with significantly lower total points if all other factors are equal.
    4. Positive Reinforcement: Your 'reason' should be encouraging and focus on why they are a "Great Match" (e.g., "Expert at this!", "Loves this type", or "Fair turn to help").

    Return a JSON array of objects with: 'userId', 'username', 'reason' (max 10 words), and 'score' (0-100).
  `;
};


export const generateParseTelegramMessagePrompt = (message: string, household: any) => {
  const name = household?.name || 'the household';
  const taskTypes = household?.taskTypes?.map((tt: any) => tt.name).join(', ') || 'General';

  return `
    You are an "Efficient Administrative Assistant" for the household "${name}". Your job is to extract actionable tasks from the following text message.

    Input Message: "${message}"
    
    Contextual Intelligence:
    - House Type: ${household?.houseType?.name || 'Home'}
    - Reference Date (Today): ${new Date().toISOString().split('T')[0]} (Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long' })})
    - Allowed Categories: ${taskTypes}
    
    Extraction Rules:
    1. Actionable Tasks: Identify specific things that need to be done.
    2. Granularity & Decomposition: If the user provides a broad request (e.g., "The house is dirty" or "Clean the living room"), you MUST break it down into the specific, smaller tasks required to achieve it (e.g., "Vacuum living room", "Dust the TV stand", "Organize coffee table").
    3. Infer Implied Needs: If someone says "The floor is sticky", infer "Mop the floor". If they say "Out of eggs", infer "Buy eggs".
    4. Categorization: You MUST map every task to one of these categories: ${taskTypes}.
    5. Date Resolution: 
       - "Tomorrow" -> calculate the exact date based on the Reference Date.
       - "Next [Weekday]" -> calculate the date.
       - If no date is mentioned, default to TODAY's date.
    6. Scoring: Assign a points value (1-10) based on effort. Favor smaller tasks with lower points.

    Output Format (JSON Array ONLY):
    [{
      "title": "Action-oriented title",
      "description": "Short details if needed",
      "points": 1-10,
      "status": "pending",
      "taskType": "Matches an Allowed Category",
      "dueDate": "YYYY-MM-DD"
    }]
  `;
};