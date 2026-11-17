import robot from './avatar-robot-parts.json';
import natural from './avatar-natural-parts.json';
import type { ChatProfile } from '../../stream/chat-profile';

// Trusted artwork only: OpenMoji 15.1.0 (CC BY-SA 4.0) and Bottts 9.4.3.
// Source geometry is fitted to Bottts' 180px canvas; each slot remains independent.
export function mixedAvatarSvg(profile: ChatProfile): string {
	const tint = (part: string) => part.replaceAll('#AVATAR_COLOR', `#${profile.robotColor}`);
	const layer = (slot: string, part: string, transform = '') => part
		? `<g data-avatar-slot="${slot}"${transform ? ` transform="${transform}"` : ''}>${tint(part)}</g>` : '';
	const robotPart = (slot: keyof typeof robot, name: string) => (robot[slot] as Record<string, string>)[name] ?? '';
	const defs = `<defs><clipPath id="cat-head"><ellipse cx="36" cy="40" rx="24" ry="22"/></clipPath><clipPath id="cat-ears"><path d="M8 7h21v25H8zM43 7h21v25H43z"/></clipPath></defs>`;
	const ears = profile.ears && profile.ears !== 'none'
		? `<g clip-path="url(#cat-ears)">${natural.catEars}</g>` : '';
	const wings = profile.wings === 'butterfly' ? natural.butterflyWings
		: profile.wings === 'mosquito' ? natural.mosquitoWings : '';
	const limbs = profile.limbs === 'ant' ? natural.antLimbs
		: profile.limbs === 'beetle' ? natural.beetleLimbs : '';
	const head = profile.face === 'cat'
		? `<ellipse cx="36" cy="40" rx="24" ry="22" fill="#AVATAR_COLOR"/><g clip-path="url(#cat-head)">${natural.catFill}</g><ellipse cx="36" cy="40" rx="24" ry="22" fill="none" stroke="#25292f" stroke-width="1.2"/>`
		: profile.face === 'bug' ? natural.bugFace + natural.bugSpots : robotPart('face', profile.face);
	const faceTransform = profile.face === 'cat' ? 'translate(0 2) scale(2.5)'
		: profile.face === 'bug' ? 'translate(-38 -38) scale(3.5)' : 'translate(25 44)';
	const mouth = profile.mouth === 'cat' ? natural.catMouth
		: profile.mouth === 'proboscis' ? natural.proboscis
		: profile.mouth === 'mandibles' ? natural.antAntennae : robotPart('mouth', profile.mouth);
	const mouthTransform = profile.mouth === 'cat' ? 'translate(0 2) scale(2.5)'
		: profile.mouth === 'proboscis' ? 'translate(90 130) rotate(180) scale(4) translate(-34.9332 -22)'
		: profile.mouth === 'mandibles' ? 'translate(90 132) rotate(180) scale(3) translate(-36 -25.7)'
		: 'translate(52 124)';
	const eyes = profile.eyes === 'cat' ? natural.catEyes
		: profile.eyes === 'bug' ? natural.bugEyes : robotPart('eyes', profile.eyes);
	const eyeTransform = profile.eyes === 'cat' ? 'translate(0 2) scale(2.5)'
		: profile.eyes === 'bug' ? 'translate(-7 10) scale(2.65)' : 'translate(38 76)';
	const top = profile.top === 'insectAntennae' ? natural.antAntennae : robotPart('top', profile.top);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none">${defs}<rect width="180" height="180" fill="#${profile.backgroundColor}"/>`
		+ layer('wings', wings, profile.wings === 'butterfly' ? 'translate(-7 0) scale(2.7)' : 'translate(-50 -48) scale(4)')
		+ layer('limbs', limbs, profile.limbs === 'ant' ? 'translate(-82.8 -25) scale(4.8 3.4)' : 'translate(-34 -25) scale(3.4)')
		+ layer('sides', robotPart('sides', profile.sides), 'translate(0 66)')
		+ layer('ears', ears, profile.ears === 'foldedCat' ? 'translate(0 16) scale(2.5 2)' : 'translate(0 2) scale(2.5)')
		+ layer('top', top, profile.top === 'insectAntennae' ? 'translate(-18 -31) scale(3)' : 'translate(41)')
		+ layer('face', head, faceTransform)
		+ layer('mouth', mouth, mouthTransform)
		+ layer('eyes', eyes, eyeTransform)
		+ layer('whiskers', profile.whiskers === 'cat' ? natural.catWhiskers : '', 'translate(10 -4) scale(2.2)')
		+ '</svg>';
}

export function needsMixedAvatar(profile: ChatProfile): boolean {
	return profile.face === 'cat' || profile.face === 'bug' || profile.eyes === 'cat' || profile.eyes === 'bug'
		|| ['none', 'cat', 'proboscis', 'mandibles'].includes(profile.mouth) || profile.top === 'insectAntennae'
		|| Boolean(profile.ears || profile.whiskers || profile.wings || profile.limbs);
}
