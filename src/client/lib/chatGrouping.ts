import type { ChatMessage } from '../../stream/chat';
import { chatProfilesEqual } from '../../stream/chat-profile';

export function continuesChatGroup(previous: ChatMessage | undefined, current: ChatMessage): boolean {
	return !!previous?.senderId && previous.senderId === current.senderId &&
		previous.sessionId === current.sessionId && previous.name === current.name &&
		chatProfilesEqual(previous.profile, current.profile);
}
