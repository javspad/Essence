"""Viewer: entra a la sala y filma frames para revisar la cámara cinematográfica."""
import os, time
from playwright.sync_api import sync_playwright

OUT = "/private/tmp/claude-501/-Users-javi-Code-Essence/77c70f6d-9268-4897-adb8-b00316fd9de6/scratchpad"
CODE_FILE = f"{OUT}/room_code.txt"
FRAMES = f"{OUT}/cam_frames"
os.makedirs(FRAMES, exist_ok=True)

code = None
for _ in range(40):
    if os.path.exists(CODE_FILE):
        code = open(CODE_FILE).read().strip()
        if code:
            break
    time.sleep(0.5)
if not code:
    raise SystemExit("sin código de sala")
print("joining", code)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1360, "height": 850})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:5173/")
    page.wait_for_load_state("networkidle")
    page.fill('input[placeholder="Tu nombre"]', "Cami")
    # botón que abre el flujo de unirse
    for label in ["Unirme", "Unirse", "Sumarse"]:
        btn = page.get_by_role("button", name=label, exact=False)
        if btn.count():
            btn.first.click()
            break
    page.wait_for_timeout(800)
    # click en la card de la sala CamTest del browser de salas
    card = page.get_by_text("CamTest", exact=False)
    if card.count():
        card.first.click()
    elif page.locator('input[placeholder="CÓDIGO"]').count():
        page.fill('input[placeholder="CÓDIGO"]', code)
        page.get_by_role("button", name="Entrar").first.click()
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{FRAMES}/lobby.png")

    # filmar ~36s; Cami tira el dado cuando le toca
    for i in range(60):
        page.screenshot(path=f"{FRAMES}/f{i:02d}.png")
        try:
            btn = page.get_by_role("button", name="TIRAR")
            if btn.count() and btn.first.is_visible():
                btn.first.click(timeout=1500, force=True)
                print(f"TIRAR @ f{i:02d}")
        except Exception as e:
            print("click err:", str(e)[:80])
        page.wait_for_timeout(600)
    print("errors:", errors[:5] if errors else "ninguno")
    browser.close()
