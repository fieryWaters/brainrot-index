"""Draws the meme-style images in eval/images/ that dataset.jsonl refers to.
Run from the repo root: uv run --with pillow python eval/make_images.py"""

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

IMAGES_DIR = Path(__file__).parent / 'images'
WIDTH = 800
HEIGHT = 800


def font(size):
    return ImageFont.load_default(size=size)


def centered_text(draw, y, text, size, fill='white', outline='black'):
    text_font = font(size)
    text_width = draw.textlength(text, font=text_font)
    draw.text(((WIDTH - text_width) / 2, y), text, font=text_font, fill=fill,
              stroke_width=max(2, size // 15), stroke_fill=outline)


def deep_fried(picture, seed):
    """Noise, blur, and heavy JPEG-style saturation, the look of a meme reposted many times."""
    noise_generator = random.Random(seed)
    pixels = picture.load()
    for _ in range(40000):
        x = noise_generator.randrange(WIDTH)
        y = noise_generator.randrange(HEIGHT)
        pixels[x, y] = (noise_generator.randrange(256), noise_generator.randrange(256), 0)
    return picture.filter(ImageFilter.GaussianBlur(1)).quantize(colors=12).convert('RGB')


def skibidi_aura():
    picture = Image.new('RGB', (WIDTH, HEIGHT), (230, 40, 20))
    draw = ImageDraw.Draw(picture)
    draw.ellipse((250, 250, 550, 550), fill=(255, 220, 0))
    centered_text(draw, 60, 'SKIBIDI AURA +9999', 64)
    centered_text(draw, 640, '6 7 6 7 6 7', 80)
    return deep_fried(picture, 1)


def me_when_the():
    picture = Image.new('RGB', (WIDTH, HEIGHT), (120, 200, 255))
    draw = ImageDraw.Draw(picture)
    # A face stretched far wider than it is tall.
    draw.ellipse((40, 300, 760, 520), fill=(255, 205, 160), outline='black', width=6)
    draw.ellipse((150, 360, 330, 420), fill='white', outline='black', width=4)
    draw.ellipse((470, 340, 700, 440), fill='white', outline='black', width=4)
    draw.line((250, 480, 600, 470), fill='black', width=10)
    centered_text(draw, 60, 'ME WHEN THE', 90)
    centered_text(draw, 640, 'WHEN THE ME', 90)
    return deep_fried(picture, 2)


def pov_ohio():
    blob_generator = random.Random(3)
    picture = Image.new('RGB', (WIDTH, HEIGHT), (40, 160, 60))
    draw = ImageDraw.Draw(picture)
    for _ in range(30):
        x = blob_generator.randrange(WIDTH)
        y = blob_generator.randrange(HEIGHT)
        size = blob_generator.randrange(40, 160)
        color = (blob_generator.randrange(256), blob_generator.randrange(256), blob_generator.randrange(256))
        draw.ellipse((x, y, x + size, y + size), fill=color)
    centered_text(draw, 80, 'POV:', 110)
    centered_text(draw, 620, 'ohio final boss', 90)
    return picture


def fanum_tax():
    picture = Image.new('RGB', (WIDTH, HEIGHT), (250, 250, 0))
    draw = ImageDraw.Draw(picture)
    for row in range(8):
        centered_text(draw, 20 + row * 95, 'FANUM TAX', 72, fill=(255, 0, 200))
    return deep_fried(picture, 4)


def two_line_meme(top_text, bottom_text, background):
    picture = Image.new('RGB', (WIDTH, HEIGHT), background)
    draw = ImageDraw.Draw(picture)
    draw.rectangle((0, HEIGHT // 2 - 3, WIDTH, HEIGHT // 2 + 3), fill='black')
    for line_number, line in enumerate(top_text):
        centered_text(draw, 120 + line_number * 70, line, 56)
    for line_number, line in enumerate(bottom_text):
        centered_text(draw, 520 + line_number * 70, line, 56)
    return picture


def code_works():
    return two_line_meme(['MY CODE:', 'works'], ['ME:', 'but why does it work'], (60, 60, 90))


def byzantium():
    return two_line_meme(
        ["ME: I'll sleep early", 'tonight'],
        ['ALSO ME AT 3AM:', 'reading about the', 'fall of Byzantium'],
        (90, 50, 40),
    )


def meeting_email():
    return two_line_meme(['THIS MEETING'], ['COULD HAVE BEEN', 'AN EMAIL'], (40, 90, 70))


def quote_dunk_carts():
    """A screenshot of a post by an invented account."""
    picture = Image.new('RGB', (WIDTH, 420), 'white')
    draw = ImageDraw.Draw(picture)
    draw.ellipse((40, 40, 120, 120), fill=(150, 150, 150))
    draw.text((140, 50), 'cart_freedom_99', font=font(34), fill='black')
    draw.text((140, 92), '@cart_freedom_99', font=font(26), fill=(110, 110, 110))
    post_lines = ["I don't return shopping carts.", "That's literally what the", 'employees are paid for.']
    for line_number, line in enumerate(post_lines):
        draw.text((40, 170 + line_number * 52), line, font=font(40), fill='black')
    draw.text((40, 360), '2:14 PM - 12.4K Likes', font=font(24), fill=(110, 110, 110))
    return picture


def poll_beach_mountains():
    picture = Image.new('RGB', (WIDTH, HEIGHT), 'white')
    draw = ImageDraw.Draw(picture)
    draw.rectangle((0, 0, WIDTH // 2, HEIGHT), fill=(70, 170, 230))
    draw.rectangle((WIDTH // 2, 0, WIDTH, HEIGHT), fill=(90, 140, 80))
    draw.polygon([(450, 700), (600, 350), (750, 700)], fill=(220, 220, 230))
    draw.ellipse((100, 450, 300, 650), fill=(250, 210, 60))
    centered_text(draw, 60, 'PICK ONE', 100)
    draw.text((90, 700), 'BEACH', font=font(70), fill='white', stroke_width=4, stroke_fill='black')
    draw.text((450, 720), 'MOUNTAINS', font=font(60), fill='white', stroke_width=4, stroke_fill='black')
    return picture


def birthday_cake():
    picture = Image.new('RGB', (WIDTH, HEIGHT), (255, 240, 230))
    draw = ImageDraw.Draw(picture)
    draw.rectangle((180, 420, 620, 680), fill=(200, 120, 70), outline='black', width=4)
    draw.rectangle((180, 420, 620, 470), fill=(255, 255, 255))
    for candle_x in [260, 360, 460, 560]:
        draw.rectangle((candle_x - 10, 320, candle_x + 10, 420), fill=(80, 140, 230))
        draw.ellipse((candle_x - 14, 280, candle_x + 14, 320), fill=(255, 170, 0))
    draw.text((250, 560), 'HAPPY BIRTHDAY', font=font(40), fill='white')
    return picture


IMAGES = {
    'skibidi-aura.png': skibidi_aura,
    'me-when-the.png': me_when_the,
    'pov-ohio.png': pov_ohio,
    'fanum-tax.png': fanum_tax,
    'code-works.png': code_works,
    'byzantium.png': byzantium,
    'meeting-email.png': meeting_email,
    'quote-dunk-carts.png': quote_dunk_carts,
    'poll-beach-mountains.png': poll_beach_mountains,
    'birthday-cake.png': birthday_cake,
}

if __name__ == '__main__':
    IMAGES_DIR.mkdir(exist_ok=True)
    for file_name, draw_image in IMAGES.items():
        draw_image().save(IMAGES_DIR / file_name)
        print(f"wrote {IMAGES_DIR / file_name}")
