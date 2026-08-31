import { db } from '@/data/db';
import { uid } from '@/lib/id';
import { nowISO } from '@/lib/date';
import type { AnswerProvenance, ChatMessage, Citation, ID } from '@/types';

export async function listChatMessages(subjectId: ID): Promise<ChatMessage[]> {
  const messages = await db.chatMessages.where('subjectId').equals(subjectId).toArray();
  return messages.sort((a, b) => a.at.localeCompare(b.at));
}

export async function appendChatMessage(input: {
  subjectId: ID;
  role: 'user' | 'assistant';
  text: string;
  provenance?: AnswerProvenance | null;
  citations?: Citation[];
}): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: uid('msg'),
    subjectId: input.subjectId,
    role: input.role,
    text: input.text,
    provenance: input.provenance ?? null,
    citations: input.citations ?? [],
    at: nowISO(),
  };
  await db.chatMessages.add(message);
  return message;
}

export async function clearChat(subjectId: ID): Promise<void> {
  await db.chatMessages.where('subjectId').equals(subjectId).delete();
}
