# Setup

To get the website running locally on your computer, you'll need to install dependencies and then get it running.  The dependencies can be installed based on these platform-specific instructions.

## Windows
Install [VSCode](https://code.visualstudio.com/), [NodeJS](https://nodejs.org/en/) (get the LTS, or long-term stable version if it asks), [Yarn](https://yarnpkg.com/en/docs/install#windows-stable), and [Git](https://git-scm.com/download/) (make sure to check the box that says "Enable Symbolic Links" when it asks).  

Open VSCode and input Ctrl-Shift-P.  Enter "git clone", select that option, and enter `https://github.com/magcius/noclip.website.git` for the repository URL.  Put it somewhere on your computer where you have disk space.

## Linux
Run these commands in the terminal.
```bash
sudo apt update
sudo apt install git node yarn
cd /path/to/directory/you/want/the/code/in/
git clone https://github.com/magcius/noclip.website.git
cd noclip.website
```

## macOS
Run the following commands in the terminal.  If you don't already have Homebrew installed, run this command first: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"`.
```bash
brew install git node yarn
cd /path/to/directory/you/want/the/code/in/
git clone https://github.com/magcius/noclip.website.git
cd noclip.website
```

## Running the site

To get the website running, open a terminal if you don't have one open already (on Windows, go to the terminal tab in VSCode) and enter these commands.

```bash
yarn install
yarn start
```

You can then access the website at http://localhost:8080.  If you do though, you'll notice that no levels load.  This is because there isn't any game data in the repository.  For legal reasons, we cannot share game data, so it's your responsibility to track down data for any games you're working on.  If you're trying to work on an existing game, poke a Developer in the Discord for game files. In most cases, you can also extract the game's ISO. Do not ask where to get game ISOs.

If you have the data and still cannot get it to load, the data symlink may not have been created by git correctly.  You can fix this with these commands.

```PowerShell
# For Windows
rm dist/data
cmd /c mklink /D dist/data data
```

```bash
# For Linux or macOS
rm dist/data
ln -s ../data dist/data
```
