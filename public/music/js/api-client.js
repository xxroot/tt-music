/**
 * API Client - 统一 API 请求封装
 * 自动注入认证 Headers、Content-Type，统一错误处理
 *
 * @module ApiClient
 */

// ============================================================================
// API 请求封装 (API Request Wrapper)
// ============================================================================

/**
 * 统一 API 请求函数，自动注入认证 headers
 * @param {string} url - 请求 URL
 * @param {object} [options={}] - fetch 选项
 * @param {object} [options.headers] - 额外 headers（会与认证 headers 合并）
 * @param {boolean} [options.silent=false] - 是否静默模式（不自动显示错误 toast）
 * @returns {Promise<Response>} 原始 Response 对象
 */
async function apiFetch(url, options = {}) {
    const {silent = false, ...fetchOptions} = options;
    const headers = fetchOptions.headers || {};

    // 自动注入认证 headers
    if (typeof window.getUserAuthHeaders === 'function') {
        Object.assign(headers, window.getUserAuthHeaders());
    }

    // 如果不是 FormData，自动设置 Content-Type: application/json
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    fetchOptions.headers = headers;

    try {
        return await fetch(url, fetchOptions);
    } catch (e) {
        if (!silent && typeof window.showError === 'function') {
            window.showError(`网络请求失败: ${e.message}`);
        }
        throw e;
    }
}

/**
 * GET 请求快捷方法
 * @param {string} url - 请求 URL
 * @param {object} [options={}] - 额外选项
 * @param {boolean} [options.silent=false] - 是否静默模式
 * @returns {Promise<Response>}
 */
function apiGet(url, options = {}) {
    return apiFetch(url, {...options, method: 'GET'});
}

/**
 * POST 请求快捷方法（JSON body）
 * @param {string} url - 请求 URL
 * @param {object|null} body - 请求体（自动 JSON.stringify）
 * @param {object} [options={}] - 额外选项
 * @param {boolean} [options.silent=false] - 是否静默模式
 * @returns {Promise<Response>}
 */
function apiPost(url, body = null, options = {}) {
    const fetchOptions = {...options, method: 'POST'};
    if (body !== null) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return apiFetch(url, fetchOptions);
}

/**
 * POST 请求并解析 JSON 响应
 * @param {string} url - 请求 URL
 * @param {object|null} body - 请求体
 * @param {object} [options={}] - 额外选项
 * @returns {Promise<object>} 解析后的 JSON 对象
 */
async function apiPostJson(url, body = null, options = {}) {
    const response = await apiPost(url, body, options);
    return response.json();
}

/**
 * GET 请求并解析 JSON 响应
 * @param {string} url - 请求 URL
 * @param {object} [options={}] - 额外选项
 * @returns {Promise<object>} 解析后的 JSON 对象
 */
async function apiGetJson(url, options = {}) {
    const response = await apiGet(url, options);
    return response.json();
}

// ============================================================================
// 暴露到全局 (Expose to Global Scope)
// ============================================================================

window.apiFetch = apiFetch;
window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiPostJson = apiPostJson;
window.apiGetJson = apiGetJson;
