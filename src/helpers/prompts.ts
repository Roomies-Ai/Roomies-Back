export const generateTasksPrompt = `
            You are a helpful assistant that generates tasks for a household maintenance app.
            Generate a list of tasks for a household maintenance app.
            The tasks should be relevant to a household maintenance app.
            the tasks should be a standart weekly tasks like cleaning the house, taking out the trash, etc.
            Return the tasks in JSON format with the following fields:
            - title: string
            - description: string
            - status: string (pending, in-progress, completed, overdue)
            `