import re

with open('/Users/work/Desktop/dailylog/invite-sender.html', 'r') as f:
    content = f.read()

# Extract the script tag
script_match = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
script_content = script_match.group(1) if script_match else ''

new_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAFDAC Inspection Scheduler</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
  <link rel="stylesheet" href="styles.css">
  <style>
    .missing-email td {{ background-color: #fff3cd !important; }}
    .invalid {{ border-color: var(--danger) !important; background: rgba(239, 68, 68, 0.05) !important; }}
    .dropzone {{ border: 2px dashed #94a3b8; padding: 3rem 2rem; text-align: center; cursor: pointer; background: #f8fafc; margin-bottom: 24px; transition: all 0.2s; }}
    .dropzone.dragover {{ border-color: var(--accent); background: #f0fff4; }}
    .loader {{ display: none; border: 3px solid #f3f3f3; border-top: 3px solid var(--accent); border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 10px auto; }}
    @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
    .inline-input {{ width: 100%; padding: 8px; border: 1px solid transparent; background: transparent; font-family: inherit; font-size: inherit; }}
    .inline-input:hover {{ border-color: #e2e8f0; }}
    .inline-input:focus {{ border-color: var(--accent); background: white; outline: none; }}
    #workspacePanel {{ display: none; }}
  </style>
</head>
<body>
  <header>
    <div class="logo-container">
      <img src="logo.png" alt="NAFDAC Logo" class="logo-img">
      <div class="logo-text">NAFDAC Post Marketing Surveillance</div>
    </div>
    <div class="flex">
      <button onclick="window.location.href='index.html'" class="secondary">Back to Dashboard</button>
    </div>
  </header>

  <main>
    <section class="card">
      <h2 style="color:var(--accent); margin-bottom: 16px;">📅 Inspection Scheduler</h2>
      <p class="muted" style="margin-bottom: 24px;">Automate Calendar Invites from Word Documents</p>
      
      <div class="row">
        <div class="col">
          <label>Groq API Key</label>
          <input type="password" id="apiKey" placeholder="gsk_..." style="padding: 12px;">
          <p class="muted small" style="margin-top:4px;">Free key from <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent)">console.groq.com</a></p>
        </div>
        <div class="col">
          <label>Default Reminder</label>
          <select id="reminderSelect" style="padding: 12px;">
            <option value="1440">1 day before</option>
            <option value="2880">2 days before</option>
            <option value="10080">1 week before</option>
            <option value="0">No reminder</option>
          </select>
        </div>
      </div>

      <div id="dropzone" class="dropzone" style="margin-top:24px;">
        <p><strong>Drag & Drop your .docx file here</strong> or click to browse</p>
        <input type="file" id="fileInput" accept=".docx" style="display: none;">
        <div class="loader" id="uploadLoader"></div>
        <p id="uploadStatus" style="color: var(--accent); font-weight: bold; margin-top:8px;"></p>
      </div>
    </section>

    <section class="card" id="workspacePanel">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <h3 style="color:var(--accent); margin:0;">Data Preview (<span id="eventCount">0</span>)</h3>
        <div class="flex">
          <button class="secondary" onclick="addNewRow()" style="padding: 8px 16px;">+ Add Row</button>
          <button class="secondary" onclick="downloadBulkICS()" style="padding: 8px 16px;">📥 Download .ics</button>
          <button class="success" onclick="sendInvites()" id="sendBtn" style="padding: 8px 16px;">✉️ Send Invites</button>
        </div>
      </div>
      
      <div id="summaryPanel" style="display:none; padding:12px; margin-bottom:16px; background:#e2e8f0; border-radius:4px;"></div>
      
      <div style="overflow-x: auto; border: 1px solid #e2e8f0;">
        <table id="dataTable">
          <thead>
            <tr>
              <th style="width: 40px;"><input type="checkbox" id="selectAll" checked onchange="toggleSelectAll()"></th>
              <th>Title</th>
              <th>Date</th>
              <th>Time</th>
              <th>Duration (Hrs)</th>
              <th>Location</th>
              <th>Inspector Name</th>
              <th>Inspector Email</th>
              <th>Type</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="tableBody">
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
{script_content}
  </script>
</body>
</html>
"""

with open('/Users/work/Desktop/dailylog/invite-sender.html', 'w') as f:
    f.write(new_html)

print("Rewrite successful")
