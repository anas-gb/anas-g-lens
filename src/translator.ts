import * as https from 'https';

/**
 * Checks if the text contains non-ASCII characters, which suggests it might be in a foreign language.
 * We ignore common mathematical symbols, smart quotes, and currency symbols.
 */
export function isForeignText(text: string): boolean {
    if (!text || text.trim().length === 0) {
        return false;
    }
    // Remove common symbols, numbers, and basic markdown characters to avoid false positives
    const cleanText = text
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-./:;<=>?@\[\]^_`{|}~]/g, '')
        .replace(/[0-9]/g, '')
        .trim();

    // Check if there are any non-ASCII characters remaining
    return /[^\x00-\x7F]/.test(cleanText);
}

/**
 * Helper to make HTTPS GET requests
 */
function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        };
        https.get(url, options, (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Translates text using the selected service
 */
export async function translateText(text: string, targetLang: string, service: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) {
        return '';
    }

    try {
        if (service.includes('Google Translate')) {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(trimmed)}`;
            const responseText = await httpsGet(url);
            const parsed = JSON.parse(responseText);
            
            if (Array.isArray(parsed) && parsed[0]) {
                return parsed[0]
                    .map((item: any) => item[0] || '')
                    .join('');
            }
            throw new Error('Invalid response from Google Translate');
        } else if (service.includes('MyMemory')) {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=auto|${targetLang}`;
            const responseText = await httpsGet(url);
            const parsed = JSON.parse(responseText);
            
            if (parsed?.responseData?.translatedText) {
                return parsed.responseData.translatedText;
            }
            throw new Error('Invalid response from MyMemory');
        } else if (service.includes('LibreTranslate')) {
            // Use a free public instance of LibreTranslate
            const url = `https://translate.argosopentech.com/translate`;
            
            return new Promise((resolve, reject) => {
                const postData = JSON.stringify({
                    q: trimmed,
                    source: "auto",
                    target: targetLang,
                    format: "text"
                });

                const req = https.request(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.translatedText) {
                                resolve(parsed.translatedText);
                            } else {
                                reject(new Error(parsed.error || 'Failed to translate'));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                req.on('error', reject);
                req.write(postData);
                req.end();
            });
        }
        
        throw new Error(`Unsupported service: ${service}`);
    } catch (error: any) {
        console.error('Translation failed:', error);
        throw new Error(`Translation failed: ${error.message || error}`);
    }
}
