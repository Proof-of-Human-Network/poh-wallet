#!/bin/bash
# Debug PoH Wallet on connected Android device
#
# Prerequisites:
# - Android device connected via USB with USB Debugging enabled + authorized
# - adb in PATH (this env has it at /home/bo/android-sdk/platform-tools/adb)
# - Expo Go app installed on the device (Play Store: "Expo Go")

set -e

echo "=== PoH Wallet Android Debug Helper ==="
echo ""

ADB_CMD="$(which adb 2>/dev/null || echo 'adb')"

# Check adb and device
echo "📱 Checking connected devices..."
$ADB_CMD devices -l

# The device ID will be listed above; replace if needed for your device
DEVICE_ID="${DEVICE_ID:-$( $ADB_CMD devices | grep -v 'List' | head -1 | awk '{print $1}' )}"

if [ -z "$DEVICE_ID" ] || ! $ADB_CMD -s $DEVICE_ID get-state >/dev/null 2>&1; then
  echo "❌ No authorized Android device found via adb."
  echo "   Connect your Android phone via USB, enable USB debugging, and authorize the computer."
  echo "   Then run 'adb devices' to see the ID, and set DEVICE_ID=yourid ./scripts/debug-android.sh"
  exit 1
fi

MODEL=$($ADB_CMD -s $DEVICE_ID shell getprop ro.product.model)
ANDROID_VER=$($ADB_CMD -s $DEVICE_ID shell getprop ro.build.version.release)
echo "✅ Device connected: $MODEL (Android $ANDROID_VER)"

echo ""
echo "Choose mode:"
echo "  1) Start Metro + instructions for Expo Go (recommended for quick JS debug)"
echo "  2) Full native build + install (slower first time, better logs/native debug)"
echo "  3) Start Metro only (you scan manually in Expo Go)"
read -p "Choice [1-3, default 1]: " choice
choice=${choice:-1}

case $choice in
  1)
    echo ""
    echo "🚀 Starting Expo dev server (tunnel mode for easy device connection)..."
    echo "   On phone: Open 'Expo Go' app → Scan the QR code that appears below."
    echo "   To open Dev Menu on phone (no shake needed):"
    echo "     $ADB_CMD -s $DEVICE_ID shell input keyevent 82"
    echo "   In Dev Menu choose 'Debug JS Remotely' → opens Chrome debugger."
    echo "   Hot reload works automatically."
    echo ""
    echo "   Press Ctrl+C when done."
    npx expo start --tunnel
    ;;
  2)
    echo ""
    echo "🛠️  Prebuilding (generates android/ folder) and building dev client..."
    echo "   This can take 5-15+ minutes on first run (compiles native code)."
    npx expo prebuild --clean
    echo "📦 Installing and launching on device..."
    npx expo run:android --device $DEVICE_ID
    echo ""
    echo "App is running on device."
    echo "Dev Menu: $ADB_CMD -s $DEVICE_ID shell input keyevent 82"
    echo "Filtered logs: $ADB_CMD -s $DEVICE_ID logcat | grep -i 'poh\|react-native' --line-buffered"
    ;;
  3)
    echo ""
    echo "🌐 Starting Metro bundler..."
    npx expo start
    echo ""
    echo "Scan the QR in Expo Go on your phone."
    ;;
  *)
    echo "Starting default..."
    npx expo start
    ;;
esac

echo ""
echo "Other useful commands (run in another terminal):"
echo "  $ADB_CMD -s $DEVICE_ID reverse tcp:8081 tcp:8081   # for localhost connections from app"
echo "  $ADB_CMD -s $DEVICE_ID logcat -c ; $ADB_CMD -s $DEVICE_ID logcat | grep -i 'poh\|expo\|react' --line-buffered"
echo "  $ADB_CMD -s $DEVICE_ID shell input keyevent 82    # open dev menu anytime"
echo ""
echo "To force launch the app on the device (Expo Go must be installed):"
echo "  $ADB_CMD -s $DEVICE_ID shell am start -a android.intent.action.VIEW -d \"exp://127.0.0.1:8081\" host.exp.exponent"
echo "  (replace 127.0.0.1 with your LAN IP from 'expo start' output if reverse not used, e.g. exp://192.168.x.x:8081 )"
echo ""
echo "For the PoH node side (if running the miner on another machine): make sure your config has good RPCs and Ollama models pulled (qwen2.5:1.5b etc) so real POH works and no low-quality rejections."