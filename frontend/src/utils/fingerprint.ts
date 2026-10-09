import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { useGlobalState } from '../store';

const { browserFingerprint } = useGlobalState();

// 并发去重：页面加载时多个 API 请求会同时调用 getFingerprint，
// 用 in-flight promise 保证 FingerprintJS.load()/get() 只执行一次。
let inflightFingerprintPromise: Promise<string> | null = null;

/**
 * Get browser fingerprint
 * Uses cached value from global state if available to avoid unnecessary computation
 * @returns Fingerprint visitor ID, or 'ERROR' if failed
 */
export const getFingerprint = async (): Promise<string> => {
    // Return cached fingerprint if available
    if (browserFingerprint.value) {
        return browserFingerprint.value;
    }
    // Deduplicate concurrent computations
    if (inflightFingerprintPromise) {
        return inflightFingerprintPromise;
    }

    inflightFingerprintPromise = (async () => {
        try {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            browserFingerprint.value = result.visitorId;
            return browserFingerprint.value;
        } catch (error) {
            console.error('Failed to get fingerprint:', error);
            // Return special error value to prevent blocking requests
            const errorValue = 'ERROR';
            browserFingerprint.value = errorValue;
            return errorValue;
        } finally {
            inflightFingerprintPromise = null;
        }
    })();
    return inflightFingerprintPromise;
};

