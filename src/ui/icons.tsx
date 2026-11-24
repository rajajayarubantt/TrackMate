// One place for every icon the app uses (Ionicons, via react-icons).
import type { IconType } from 'react-icons';
import {
  IoAdd, IoAlarmOutline, IoArrowBack, IoArrowForward, IoArrowUp, IoBookmark, IoBookmarkOutline, IoBulbOutline, IoCalendar,
  IoCalendarOutline, IoChatboxOutline, IoCheckbox, IoCheckboxOutline, IoCheckmark, IoCheckmarkCircle, IoCheckmarkCircleOutline,
  IoChevronBack, IoChevronDown, IoChevronForward, IoClipboardOutline, IoClose, IoCloseCircle, IoCloudDoneOutline,
  IoCodeSlashOutline, IoColorPaletteOutline, IoContrastOutline, IoCopyOutline, IoCreateOutline, IoDocumentText,
  IoDocumentTextOutline, IoDownloadOutline, IoEllipse, IoEllipseOutline, IoEllipsisHorizontal, IoEyeOffOutline, IoEyeOutline,
  IoFilter, IoFlag, IoFlagOutline, IoFlash, IoFolderOpenOutline, IoGlobeOutline, IoGridOutline, IoHourglassOutline,
  IoInformationCircleOutline, IoKeyOutline, IoLink, IoLinkOutline, IoListOutline, IoLocationOutline, IoLockClosed,
  IoLogOutOutline, IoMailOutline, IoMoon, IoNotifications, IoNotificationsOffOutline, IoNotificationsOutline, IoOpenOutline,
  IoPause, IoPeopleOutline, IoPersonOutline, IoPin, IoPinOutline, IoPlay, IoPricetags, IoPricetagsOutline, IoRefresh,
  IoRemove, IoReorderTwoOutline, IoRepeat, IoSearch, IoSettingsOutline, IoSparkles, IoStop, IoSunny, IoSwapVertical, IoText,
  IoTimeOutline, IoTimerOutline, IoToday, IoTodayOutline, IoTrashOutline, IoVideocam, IoVideocamOutline, IoWarningOutline,
  IoWaterOutline, IoPhonePortraitOutline, IoShareOutline, IoListCircleOutline, IoRemoveCircleOutline, IoLayersOutline,
  IoArrowUndo, IoSaveOutline, IoAlbumsOutline, IoPersonCircleOutline, IoSwapHorizontal, IoEllipsisHorizontalCircle,
  IoTextOutline, IoArrowDown, IoCloudOfflineOutline, IoCloudUploadOutline, IoPersonRemoveOutline,
  // Tag icon set
  IoAirplane, IoAlarm, IoAnalytics, IoAt, IoAttach, IoBag, IoBarbell, IoBarChart, IoBasket, IoBasketball, IoBed, IoBicycle,
  IoBoat, IoBook, IoBriefcase, IoBrush, IoBug, IoBuild, IoBulb, IoBusiness, IoCafe, IoCalculator, IoCall, IoCamera, IoCar,
  IoCard, IoCart, IoCash, IoChatbubbles, IoCloud, IoCodeSlash, IoColorPalette, IoCompass, IoConstruct, IoCube, IoDesktop,
  IoDiamond, IoEarth, IoExtensionPuzzle, IoEye, IoFilm, IoFingerPrint, IoFitness, IoFlame, IoFlask, IoFolder, IoFootball,
  IoGameController, IoGift, IoGitBranch, IoGlasses, IoGlobe, IoGolf, IoHammer, IoHardwareChip, IoHeadset, IoHeart, IoHome,
  IoImage, IoInfinite, IoKey, IoLanguage, IoLayers, IoLeaf, IoLibrary, IoMail, IoMap, IoMedal, IoMedkit, IoMegaphone, IoMic,
  IoMusicalNotes, IoNewspaper, IoPaw, IoPeople, IoPerson, IoPhonePortrait, IoPieChart, IoPizza, IoPlanet, IoPricetag, IoPulse,
  IoRestaurant, IoRibbon, IoRocket, IoSchool, IoServer, IoShield, IoShirt, IoSnow, IoStar, IoStatsChart, IoStorefront,
  IoTennisball, IoTerminal, IoTime, IoTrendingUp, IoTrophy, IoTv, IoUmbrella, IoWalk, IoWallet, IoWifi, IoWine,
} from 'react-icons/io5';

/** The up/down chevron pair used on pop-up buttons. */
const ChevronUpDown: IconType = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.6 6.1 8 2.8l3.4 3.3M4.6 9.9 8 13.2l3.4-3.3" />
  </svg>
);

export const Icon = {
  add: IoAdd, alarm: IoAlarmOutline, back: IoArrowBack, forward: IoArrowForward, up: IoArrowUp, down: IoArrowDown,
  bookmark: IoBookmark, bookmarkOutline: IoBookmarkOutline, callout: IoBulbOutline, calendar: IoCalendar,
  calendarOutline: IoCalendarOutline, quote: IoChatboxOutline, checkbox: IoCheckbox, checkboxOutline: IoCheckboxOutline,
  check: IoCheckmark, checkCircle: IoCheckmarkCircle, checkCircleOutline: IoCheckmarkCircleOutline,
  chevronBack: IoChevronBack, chevronDown: IoChevronDown, chevronExpand: ChevronUpDown, chevronForward: IoChevronForward,
  clipboard: IoClipboardOutline, close: IoClose, closeCircle: IoCloseCircle, saved: IoCloudDoneOutline, code: IoCodeSlashOutline,
  palette: IoColorPaletteOutline, contrast: IoContrastOutline, copy: IoCopyOutline, edit: IoCreateOutline, note: IoDocumentText,
  noteOutline: IoDocumentTextOutline, download: IoDownloadOutline, dot: IoEllipse, circle: IoEllipseOutline,
  more: IoEllipsisHorizontal, moreCircle: IoEllipsisHorizontalCircle, eyeOff: IoEyeOffOutline, eye: IoEyeOutline, filter: IoFilter,
  flag: IoFlag, flagOutline: IoFlagOutline, flash: IoFlash, folder: IoFolderOpenOutline, globe: IoGlobeOutline, grid: IoGridOutline,
  hourglass: IoHourglassOutline, info: IoInformationCircleOutline, key: IoKeyOutline, link: IoLink, linkOutline: IoLinkOutline,
  list: IoListOutline, location: IoLocationOutline, lock: IoLockClosed, signOut: IoLogOutOutline, mail: IoMailOutline,
  moon: IoMoon, bell: IoNotifications, bellOff: IoNotificationsOffOutline, bellOutline: IoNotificationsOutline,
  open: IoOpenOutline, pause: IoPause, people: IoPeopleOutline, person: IoPersonOutline, personCircle: IoPersonCircleOutline,
  pin: IoPin, pinOutline: IoPinOutline, play: IoPlay, tags: IoPricetags, tagsOutline: IoPricetagsOutline, refresh: IoRefresh,
  minus: IoRemove, drag: IoReorderTwoOutline, repeat: IoRepeat, search: IoSearch, settings: IoSettingsOutline,
  sparkles: IoSparkles, stop: IoStop, sun: IoSunny, sort: IoSwapVertical, swap: IoSwapHorizontal, text: IoText,
  textOutline: IoTextOutline, time: IoTimeOutline, timer: IoTimerOutline, today: IoToday, todayOutline: IoTodayOutline,
  trash: IoTrashOutline, video: IoVideocam, videoOutline: IoVideocamOutline, warning: IoWarningOutline, glass: IoWaterOutline,
  phone: IoPhonePortraitOutline, share: IoShareOutline, bullets: IoListCircleOutline, divider: IoRemoveCircleOutline,
  layers: IoLayersOutline, undo: IoArrowUndo, save: IoSaveOutline, board: IoAlbumsOutline,
  cloudOff: IoCloudOfflineOutline, cloudUp: IoCloudUploadOutline, personRemove: IoPersonRemoveOutline,
} satisfies Record<string, IconType>;

/** Icons a tag can use, in the order the picker shows them. */
export const TAG_ICONS: Record<string, IconType> = {
  pricetag: IoPricetag, briefcase: IoBriefcase, home: IoHome, heart: IoHeart, star: IoStar, bookmark: IoBookmark, flag: IoFlag,
  flame: IoFlame, flash: IoFlash, bulb: IoBulb, book: IoBook, school: IoSchool, library: IoLibrary, newspaper: IoNewspaper,
  code: IoCodeSlash, terminal: IoTerminal, branch: IoGitBranch, bug: IoBug, chip: IoHardwareChip, server: IoServer,
  desktop: IoDesktop, phone: IoPhonePortrait, wifi: IoWifi, rocket: IoRocket, planet: IoPlanet, globe: IoGlobe, earth: IoEarth,
  compass: IoCompass, map: IoMap, airplane: IoAirplane, car: IoCar, bicycle: IoBicycle, boat: IoBoat, walk: IoWalk,
  fitness: IoFitness, barbell: IoBarbell, pulse: IoPulse, medkit: IoMedkit, leaf: IoLeaf, paw: IoPaw, restaurant: IoRestaurant,
  cafe: IoCafe, pizza: IoPizza, wine: IoWine, cart: IoCart, bag: IoBag, basket: IoBasket, store: IoStorefront, card: IoCard,
  cash: IoCash, wallet: IoWallet, stats: IoStatsChart, trending: IoTrendingUp, pie: IoPieChart, bars: IoBarChart,
  analytics: IoAnalytics, calculator: IoCalculator, business: IoBusiness, people: IoPeople, person: IoPerson,
  chat: IoChatbubbles, mail: IoMail, call: IoCall, megaphone: IoMegaphone, mic: IoMic, at: IoAt, attach: IoAttach,
  calendar: IoCalendar, time: IoTime, alarm: IoAlarm, camera: IoCamera, image: IoImage, film: IoFilm, tv: IoTv,
  music: IoMusicalNotes, headset: IoHeadset, game: IoGameController, brush: IoBrush, palette: IoColorPalette,
  construct: IoConstruct, hammer: IoHammer, build: IoBuild, key: IoKey, shield: IoShield, fingerprint: IoFingerPrint, eye: IoEye,
  glasses: IoGlasses, language: IoLanguage, flask: IoFlask, puzzle: IoExtensionPuzzle, cube: IoCube, layers: IoLayers,
  folder: IoFolder, cloud: IoCloud, snow: IoSnow, umbrella: IoUmbrella, gift: IoGift, trophy: IoTrophy, medal: IoMedal,
  ribbon: IoRibbon, diamond: IoDiamond, infinite: IoInfinite, football: IoFootball, basketball: IoBasketball,
  tennis: IoTennisball, golf: IoGolf, bed: IoBed, shirt: IoShirt,
};

export function TagGlyph({ name, size = 16 }: { name: string; size?: number }) {
  const Glyph = TAG_ICONS[name] ?? IoPricetag;
  return <Glyph size={size} />;
}
