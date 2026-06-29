<img width="1890" height="997" alt="260629_13h59m34s_screenshot" src="https://github.com/user-attachments/assets/d9ad2a18-27e1-44d5-8792-730941424c50" />
# Anas G Lens 🌐

**Anas G Lens** is a lightweight, real-time VS Code translation extension designed to help you debug code written by developers from other countries (e.g., Chinese, Russian, Spanish, Urdu, etc.). It translates comments, docstrings, and custom text selections on the fly.

---

## Features

### 1. Hover Translation
Simply hover over any comment or docstring written in a foreign language to see an instant translation tooltip in English (or your preferred target language).

### 2. Inline CodeLens
A small `🌐 Translate` button appears above foreign comments. Clicking it displays the translated text inline as italic ghost text without modifying the source file.

### 3. Translate Selected Text
Highlight any code, docstring, or error log, right-click, and select **Anas G Lens: Translate Selected Text**. You can choose to **Replace Selection** or **Insert Below** the translation.

### 4. File-Wide Batch Translation
Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run **Anas G Lens: Translate All Comments in File** to translate and replace all foreign comments in the current file in a single batch.

---

## ⚡ 1-Command Installation

You can install this extension locally on any device running VS Code.

### For macOS and Linux (Terminal)
Run this command in your terminal to download, compile, and install the extension:
```bash
curl -fsSL https://raw.githubusercontent.com/anas-gb/anas-g-lens/main/install.sh | bash
```
*(Alternatively, clone the repository, navigate to the folder, and run `./install.sh`)*

### For Windows (PowerShell)
Run this command in PowerShell (as Administrator):
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/anas-gb/anas-g-lens/main/install.ps1'))
```
*(Alternatively, clone the repository, navigate to the folder, and run `./install.ps1`)*

---

## Configuration Settings

You can customize the extension via your VS Code Settings (`Ctrl+,` or `Cmd+,`):

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `anasGLens.targetLanguage` | `string` | `"en"` | Target language code (e.g., `'en'` for English, `'ur'` for Urdu, `'es'` for Spanish). |
| `anasGLens.enableHoverTranslation` | `boolean` | `true` | Enable translation tooltips on hover. |
| `anasGLens.enableCodeLens` | `boolean` | `true` | Show `🌐 Translate` inline action above foreign comments. |
| `anasGLens.translationService` | `enum` | `"Google Translate (Free Web API)"` | Choose from `Google Translate`, `MyMemory`, or `LibreTranslate`. |

---

## Requirements

Before running the installation, ensure you have:
* [Node.js](https://nodejs.org/) (v16.0.0 or higher)
* [VS Code](https://code.visualstudio.com/) installed with the command-line utility `code` added to your system path.
