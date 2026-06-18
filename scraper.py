from playwright.async_api import async_playwright

async def get_trends(keyword: str):
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(f"https://www.google.com/search?q={keyword}")
            await page.wait_for_selector("h3", timeout=10000)

            resultados = await page.evaluate('''() => {
                const items = document.querySelectorAll('h3');
                const data = [];
                items.forEach((item, index) => {
                    if (index < 5) {
                        const parent = item.closest('a');
                        data.push({
                            title: item.innerText,
                            url: parent ? parent.href : ''
                        });
                    }
                });
                return data;
            }''')

            await browser.close()

            return {
                "status": "success",
                "keyword": keyword,
                "results": resultados,
                "message": f"Se encontraron {len(resultados)} resultados para '{keyword}'"
            }

    except Exception as e:
        return {
            "status": "error",
            "keyword": keyword,
            "message": f"Error al scrapear: {str(e)}",
            "results": []
        }