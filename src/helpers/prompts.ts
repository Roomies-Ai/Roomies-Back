export const generateTasksPrompt = (household: any) => {
  const name = household?.name || 'a general household';
  const houseType = household?.houseType?.name || 'House';
  
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
            Return the tasks in JSON format with the following fields:
            - title: string
            - description: string
            - status: string (pending, in-progress, completed, overdue)
            - points: number (1-10 based on difficulty)
            `;
};