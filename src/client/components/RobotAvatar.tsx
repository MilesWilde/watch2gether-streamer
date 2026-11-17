import { useMemo } from 'react';
import type { ChatProfile } from '../../stream/chat-profile';
import { robotAvatarDataUri } from '../lib/robotAvatar';

type RobotAvatarProps = {
	profile?: ChatProfile;
	size?: number;
	alt?: string;
	className?: string;
};

export function RobotAvatar({ profile, size = 36, alt = '', className }: RobotAvatarProps) {
	const dimension = Number.isFinite(size) && size > 0 ? size : 36;
	// Keep mounted avatars stable even after the bounded shared cache evicts their SVG.
	const src = useMemo(() => robotAvatarDataUri(profile), [
		profile?.face, profile?.eyes, profile?.mouth, profile?.top, profile?.sides,
		profile?.robotColor, profile?.backgroundColor,
		profile?.ears, profile?.whiskers, profile?.wings, profile?.limbs,
	]);
	return <img className={['robot-avatar', className].filter(Boolean).join(' ')}
		src={src} alt={alt} width={dimension} height={dimension}
		style={{ width: dimension, height: dimension, flexShrink: 0, aspectRatio: '1 / 1' }} draggable={false} />;
}
