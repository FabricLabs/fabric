# Recommendations for Settings, Deploy, and Operation of Fabric-based programs
Complete overview of all agreed-upon recommendations for optimal flow.

## Contributing
Contributors should read [`CONTRIBUTING.md`][contributing] in the Fabric root.

## Security
### Git
Git assures we maintain version control over all releases, with our primary
goal being to build Fabric from source and generate a deterministic build.

**The Recommendations:**
1. Use Command Line Git.  It's self-explanatory.  You can do it!
2. When preparing to share something with your peers, follow these steps:
  0. (Initial Git Install) Ensure [your environment][environment-setup] is setup
  1. Run `git status` to check which files have changed locally
  2. Any files with secret information: `git add -i FILENAME`
    1. Ensure to only add non-private information
  3. Any files you want to share: `git add FILENAME`
  4. Commit to your changes:
    1. Create commit locally: `git commit`
      0. Always use a Capital Letter first, highlight defined terms using Capital Letters, and avoid any punctuating marks
      1. Ensure message contents contains
        1. A brief description of the changes (< 80 characters)
    2. Push to your public share: `git push origin`
    3. (If Upstream Project Exists) `git push upstream`
  5. Click the link in the output of `git push upstream` to acquire SUBMIT_PROPOSAL_HTTP
  6. [Submit a Pull Request][submit-a-pull-request]!
3. Use [Nix][nix].

[contributing]: /CONTRIBUTING.md
[environment-setup]: https://dev.fabric.pub/documents/environment-setup [404]
[nix]: https://nixos.org
[submit-a-pull-request]: https://dev.fabric.pub/documents/submit-a-pull-request [404]
