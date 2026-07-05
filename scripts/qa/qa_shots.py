"""QA visual: screenshots del map-builder y del mapa 3D nuevo (vite dev en 5173)."""
import sys
from playwright.sync_api import sync_playwright

OUT = "/private/tmp/claude-501/-Users-javi-Code-Essence/77c70f6d-9268-4897-adb8-b00316fd9de6/scratchpad"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/map-builder")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    page.screenshot(path=f"{OUT}/qa_builder.png")

    # Preview 3D grande
    page.get_by_role("button", name="Open").click()
    page.wait_for_timeout(3500)
    page.screenshot(path=f"{OUT}/qa_3d_start.png")

    # Saltar a una celda del medio y al final
    try:
        sel = page.locator("select").last
        opts = sel.locator("option").all_inner_texts()
        mid = opts[len(opts) // 2]
        sel.select_option(index=len(opts) // 2)
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/qa_3d_mid.png")
        print("mid cell:", mid, "| total cells:", len(opts))
    except Exception as e:
        print("mid jump err:", e)

    try:
        page.get_by_role("button", name="Finish").click()
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{OUT}/qa_3d_finish.png")
    except Exception as e:
        print("finish err:", e)

    print("== PAGE ERRORS ==" if errors else "== NO PAGE ERRORS ==")
    for e in errors[:12]:
        print("  ", e[:200])
    browser.close()
