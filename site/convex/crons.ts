import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Rooms close 15 minutes after the last player action; checking every minute keeps that within a minute.
crons.interval('close idle rooms', { minutes: 1 }, internal.rooms.closeIdle, {});

export default crons;
