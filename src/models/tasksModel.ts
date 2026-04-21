import mongoose, { Schema, Document } from 'mongoose';

export interface ITask extends Document {
    title: string;
    description: string;
    status: string;
    dueDate: Date;
    assignee: string;
}

const taskSchema = new Schema<ITask>({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'in-progress', 'completed', 'overdue'],
        default: 'pending'
    },
    dueDate: {
        type: Date,
        required: false
    },
    assignee: {
        type: String,
        required: false,
    }
}, {
    timestamps: true
});

const taskModel = mongoose.model<ITask>('Task', taskSchema);

export default taskModel;
