import { afterEach, expect, it, vi } from 'vitest';
import { getServerNowMs, resetServerClock, sampleServerClock } from '../src/client/lib/serverClock';

afterEach(() => { resetServerClock(); vi.restoreAllMocks(); });

it('anchors to server time and advances using a monotonic clock despite local clock changes', () => {
	const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1000);
	sampleServerClock(50000, 100);
	expect(getServerNowMs()).toBe(50050);
	monotonic.mockReturnValue(2000);
	vi.spyOn(Date, 'now').mockReturnValue(99999999);
	expect(getServerNowMs()).toBe(51050);
});

it('ignores invalid clock samples and falls back before authentication', () => {
	vi.spyOn(Date, 'now').mockReturnValue(10000);
	resetServerClock();
	sampleServerClock(NaN);
	expect(getServerNowMs()).toBe(10000);
});

it('retains the accurate clock when a later pong is delayed', () => {
	const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1000);
	sampleServerClock(50000, 100);
	monotonic.mockReturnValue(11000);
	sampleServerClock(51000, 10000);
	expect(getServerNowMs()).toBe(60050);
});
