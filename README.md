# Pixel Office 👾

[English](#english) · [فارسی](#فارسی)

---

## English

A mod for Claude Code that shows an 8-bit office in the style of *The Office*, right beside the chat, inside the app.

### The boss's office
The boss is the main chat, sitting behind the glass wall of his own room.
- **Two clocks on the wall behind him**:
  - `5H`: how much of the 5-hour quota is used, the same number Claude shows
  - `CTX`: how much of this chat's context window is used, the same number the chat shows
  - Colours go green, yellow, red as room runs out; when almost nothing is left the clock's rim blinks
- **The whiteboard** shows by default:
  - `CACHE`: tokens read from cache, plus the hit rate
  - `TOKENS`: all tokens used in the session, agents included
  - `WEEK`: how much of the weekly limit is used, plus hours until it resets
  - `COST`: what this session has cost, in dollars
  - Pick what goes on the board with `/board`, e.g. `/board week cost cache ctx time`
    - Items: `cache tokens week cost quota ctx time`
    - Everything: `all`
    - Back to the default: `reset`
  - Your choice is remembered for later sessions

### The bullpen
Each subagent gets its own numbered desk, one desk per agent, and its monitor shows what it is doing:
editing files, reading, terminal, web, planning, or asking you something.
When it finishes it turns grey and shows Zz.
Desks run down the room in columns, each pair of columns facing across their monitors: two columns up to 8 agents, and past 8 smaller desks in four columns.
The office follows the pane: in a tall pane the boss's room is on top with the bullpen below; in a wide pane the whole office turns sideways, the room down the left behind a glass wall and the desks to its right. In a wide, short pane (docked under the chat) the office shrinks to a strip about as tall as the chat box: the picture on the left, and beside it every figure as a short chip and every agent as its number and what it is doing.
The bullpen seats up to 32 agents. Claude Code itself runs at most 20 subagents at once by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` raises that); tested with 20 running together.

Under the picture every number is written out in full; cost is shown to 4 decimal places.
Click a row to open that agent's transcript.

### The HANDOFF button
When the context is filling up, press this button (or run `/handoff`, or press `h` in the pane). **The current chat is left untouched.** Then:
1. Claude writes a full handoff memo: the goal, what is done, where things stand, a checklist of what remains, decisions made, and next steps
2. The memo is saved in the project: `.claude/handoffs/handoff-<date>.md`
3. A short prompt to carry on is copied to the clipboard and shown in the pane:
   "Continue the work described in this file…"
4. Open a new chat and paste it. The new chat reads the file and picks up from "Next steps"

Extra keys after a handoff:
- `c`: copy the prompt again
- `t`: start Claude Code in a new terminal window, in this project, with that prompt (Windows, macOS, Linux)

Once the context passes 75% the button turns red and a warning is shown.

### Install
In Claude Code:
```
/plugin marketplace add SepiNick/Pixel-Office
/plugin install pixel-office@sepi-mods
```
The pane opens by itself at the start of each session. If you close it, `/office` brings it back.

> Built and tested on Claude Code 2.1.302.
> - The 5H and WEEK numbers only appear on Pro and Max accounts
> - Looks best in a full-screen terminal at least 110 columns wide, or in the Code tab of the desktop app
> - In the desktop app the whiteboard always hangs beside the boss and the picture shrinks to fit the pane; in a terminal that needs 110 columns or more, and narrower a whiteboard on wheels stands in front of his desk

---

<div dir="rtl">

## فارسی

یه ماد برای Claude Code که کنار صفحه چت، داخل خود اپ، یه دفتر ۸بیتی به سبک سریال The Office نشون میده.

### اتاق رئیس
رئیس همون چت اصلیه و پشت دیوار شیشه‌ای اتاق خودش نشسته.
- **دو ساعت پشت سرش**:
  - `5H`: درصد مصرف‌شده از سهمیه ۵ساعته، همون عددی که خود Claude نشون میده
  - `CTX`: درصد مصرف‌شده از کانتکس ویندوی همین چت، همون عددی که خود چت نشون میده
  - رنگ‌ها: سبز، زرد، قرمز، هرچی جا کمتر بشه. وقتی تقریباً جایی نمونده، قاب ساعت چشمک می‌زنه
- **تخته سفید**: به‌طور پیش‌فرض این‌ها رو نشون میده:
  - `CACHE`: توکن‌هایی که از کش خونده شده + درصد hit rate
  - `TOKENS`: کل توکن‌های مصرفی سشن، با احتساب ایجنت‌ها
  - `WEEK`: درصد مصرف‌شده از لیمیت هفتگی + چند ساعت تا ریست
  - `COST`: هزینه همین سشن به دلار
  - با `/board` انتخاب می‌کنی چی روی تخته باشه. مثال: `/board week cost cache ctx time`
    - گزینه‌ها: `cache tokens week cost quota ctx time`
    - همه گزینه‌ها: `all`
    - برگشت به پیش‌فرض: `reset`
  - انتخابت برای سشن‌های بعدی هم ذخیره میشه

### سالن
هر ساب‌ایجنت میز شماره‌دار خودش رو داره، یعنی به تعداد ایجنت‌ها میز هست، و مانیتورش نشون میده مشغول چیه:
ویرایش فایل، خوندن، ترمینال، وب، برنامه‌ریزی یا پرسیدن از تو.
وقتی کارش تموم بشه خاکستری میشه و Zz نشون میده.
میزها توی ستون‌های عمودی چیده میشن و هر دو ستون روبروی هم‌ان: تا ۸ ایجنت دو ستون، از ۸ تا بیشتر بشن میزها کوچیک‌تر میشن و چهار ستون میشن.
دفتر خودش رو با شکل پنل هماهنگ می‌کنه: توی پنل عمودی اتاق رئیس بالاست و سالن زیرش؛ توی پنل افقی کل دفتر افقی میشه، اتاق رئیس سمت چپ پشت یه دیوار شیشه‌ای و میزها سمت راستش. توی پنل پهن و کوتاه (وقتی زیر چت داک میشه) دفتر یه نوار باریک به اندازه‌ی چت‌باکس میشه: تصویر سمت چپ، و کنارش همه‌ی آمار به‌صورت کوتاه و هر ایجنت با شماره و کاری که داره می‌کنه.
سالن تا ۳۲ ایجنت جا داره. خود Claude Code به‌طور پیش‌فرض حداکثر ۲۰ ساب‌ایجنت رو هم‌زمان اجرا می‌کنه (با `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` بیشترش کن)؛ با ۲۰ ایجنت هم‌زمان تست شده.

زیر تصویر همه عددها با جزئیات کامل نوشته میشن. هزینه با ۴ رقم اعشار نمایش داده میشه.
با کلیک روی هر ردیف، ترنسکریپت همون ایجنت باز میشه.

### دکمه HANDOFF
وقتی کانتکس داره پر میشه، این دکمه رو بزن (یا `/handoff`، یا کلید `h` توی پنل). **چت فعلی دست نمی‌خوره.** این اتفاق‌ها می‌افته:
1. Claude یه یادداشت تحویل کامل می‌نویسه: هدف، کارهای انجام‌شده، وضعیت فعلی، چک‌لیست کارهای باقی‌مونده، تصمیم‌ها و قدم‌های بعدی
2. یادداشت توی پروژه ذخیره میشه: `.claude/handoffs/handoff-<تاریخ>.md`
3. یه پرامپت کوتاه برای ادامه کار کپی میشه توی کلیپ‌بورد و توی پنل هم نشون داده میشه:
   «کار توصیف‌شده در این فایل رو ادامه بده…»
4. یه چت جدید باز کن و پرامپت رو paste کن. چت جدید فایل رو می‌خونه و از «قدم‌های بعدی» ادامه میده

دکمه‌های اضافه بعد از handoff:
- `c`: دوباره کپی کن
- `t`: Claude Code رو توی یه پنجره ترمینال جدید، توی همین پروژه، با همین پرامپت باز کن (ویندوز، مک، لینوکس)

وقتی کانتکس از ۷۵٪ بگذره، دکمه قرمز میشه و یه هشدار هم نمایش داده میشه.

### نصب
توی Claude Code:

</div>

```
/plugin marketplace add SepiNick/Pixel-Office
/plugin install pixel-office@sepi-mods
```

<div dir="rtl">

پنل اول هر سشن خودش باز میشه. اگه بستیش، با `/office` دوباره بازش کن.

> ساخته‌شده و تست‌شده روی Claude Code 2.1.302.
> - عددهای 5H و WEEK فقط برای اکانت‌های Pro و Max میان
> - بهترین نمایش: ترمینال تمام‌صفحه با عرض ۱۱۰ ستون به بالا، یا تب Code در اپ دسکتاپ
> - توی اپ دسکتاپ تخته همیشه کنار رئیس روی دیواره و تصویر به اندازه‌ی پنل کوچیک میشه؛ توی ترمینال این از عرض ۱۱۰ ستون به بالاست و توی عرض کمتر، یه تخته چرخدار جلوی میزش وایمیسه

</div>
