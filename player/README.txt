screen-wall-player.exe is mpv, the free video player, renamed. Screen Wall
uses it to show SRT streams, which its web pages cannot play.

Build: mpv-x86_64-20261111-git-bcde6b93cc.7z from
https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261111
(a copy is kept at https://github.com/Dataworks-Technology/Screen-Wall/releases/tag/mpv-20261111)

mpv and the FFmpeg it is built with are licensed under the GNU General Public
License version 3 (COPYING.txt). Their source code:
  mpv:    https://github.com/mpv-player/mpv (commit bcde6b93cc)
  build:  https://github.com/shinchiro/mpv-winbuild-cmake, which lists the
          exact source of every library it builds in.
