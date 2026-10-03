import { unlinkSync, existsSync } from 'node:fs';
import { hashPassword } from './auth.ts';
import { DEFAULT_DB_PATH, openDb, tx, type Db } from './db.ts';
import { Repo } from './repo.ts';
import { makeRng } from './simulate.ts';

/** Демонстрационные учётные записи (только для локального запуска). */
export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@smartassign.local', password: 'Admin#2025' },
  manager: { email: 'manager@smartassign.local', password: 'Manager#2025' },
  employee: { email: 'ivanov@smartassign.local', password: 'Employee#2025' },
};

const SKILLS: [string, string][] = [
  ['TypeScript', 'Разработка'],
  ['React', 'Разработка'],
  ['Node.js', 'Разработка'],
  ['Python', 'Разработка'],
  ['SQL и проектирование БД', 'Данные'],
  ['Аналитика данных', 'Данные'],
  ['Docker и CI/CD', 'Инфраструктура'],
  ['Тестирование', 'Качество'],
  ['UI/UX-дизайн', 'Дизайн'],
  ['Системный анализ', 'Анализ'],
  ['Техническая документация', 'Анализ'],
  ['Информационная безопасность', 'Инфраструктура'],
];

interface EmpSeed {
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  position: string;
  capacity: number;
  skills: Record<string, number>;
  speed: number;
}

const EMPLOYEES: EmpSeed[] = [
  { name: 'Волков Андрей Сергеевич', email: 'admin@smartassign.local', role: 'admin', position: 'Администратор системы', capacity: 20, skills: { 'Docker и CI/CD': 4, 'Информационная безопасность': 4, 'SQL и проектирование БД': 3 }, speed: 1.0 },
  { name: 'Соколова Марина Игоревна', email: 'manager@smartassign.local', role: 'manager', position: 'Руководитель группы разработки', capacity: 30, skills: { 'Системный анализ': 5, 'Техническая документация': 4, 'Аналитика данных': 3 }, speed: 1.0 },
  { name: 'Иванов Дмитрий Олегович', email: 'ivanov@smartassign.local', role: 'employee', position: 'Ведущий разработчик', capacity: 40, skills: { TypeScript: 5, React: 5, 'Node.js': 4, Тестирование: 3 }, speed: 1.25 },
  { name: 'Петрова Анна Викторовна', email: 'petrova@smartassign.local', role: 'employee', position: 'Разработчик', capacity: 40, skills: { TypeScript: 3, React: 4, 'UI/UX-дизайн': 3, 'Аналитика данных': 2 }, speed: 1.0 },
  { name: 'Кузнецов Максим Павлович', email: 'kuznetsov@smartassign.local', role: 'employee', position: 'Разработчик серверной части', capacity: 40, skills: { 'Node.js': 4, TypeScript: 4, 'SQL и проектирование БД': 4, Python: 3 }, speed: 1.1 },
  { name: 'Смирнова Елена Александровна', email: 'smirnova@smartassign.local', role: 'employee', position: 'Аналитик данных', capacity: 40, skills: { Python: 5, 'Аналитика данных': 5, 'SQL и проектирование БД': 4 }, speed: 1.15 },
  { name: 'Морозов Илья Николаевич', email: 'morozov@smartassign.local', role: 'employee', position: 'Инженер DevOps', capacity: 40, skills: { 'Docker и CI/CD': 5, 'Информационная безопасность': 4, Python: 3, 'Node.js': 2 }, speed: 1.05 },
  { name: 'Новикова Ольга Дмитриевна', email: 'novikova@smartassign.local', role: 'employee', position: 'Инженер по тестированию', capacity: 40, skills: { Тестирование: 5, 'Техническая документация': 3, TypeScript: 2 }, speed: 1.0 },
  { name: 'Фёдоров Артём Львович', email: 'fedorov@smartassign.local', role: 'employee', position: 'Дизайнер интерфейсов', capacity: 32, skills: { 'UI/UX-дизайн': 5, React: 2, 'Техническая документация': 2 }, speed: 0.95 },
  { name: 'Лебедева Ксения Романовна', email: 'lebedeva@smartassign.local', role: 'employee', position: 'Системный аналитик', capacity: 40, skills: { 'Системный анализ': 5, 'Техническая документация': 5, 'SQL и проектирование БД': 4 }, speed: 1.1 },
  { name: 'Захаров Егор Борисович', email: 'zakharov@smartassign.local', role: 'employee', position: 'Младший разработчик', capacity: 40, skills: { TypeScript: 2, React: 2, 'Node.js': 2, Тестирование: 2 }, speed: 0.8 },
  { name: 'Орлова Виктория Андреевна', email: 'orlova@smartassign.local', role: 'employee', position: 'Специалист по информационной безопасности', capacity: 40, skills: { 'Информационная безопасность': 5, 'Docker и CI/CD': 3, Python: 3, 'Node.js': 3, 'Системный анализ': 2 }, speed: 1.0 },
];

interface TaskTpl {
  title: string;
  description: string;
  hours: number;
  priority: number;
  req: [string, number][];
}

const TASKS: TaskTpl[] = [
  { title: 'Разработать REST API модуля заявок', description: 'Реализовать CRUD-эндпоинты, валидацию входных данных и документацию OpenAPI.', hours: 24, priority: 2, req: [['Node.js', 3], ['TypeScript', 3]] },
  { title: 'Вёрстка формы создания задачи', description: 'Адаптивная форма с проверкой полей и выбором требуемых навыков.', hours: 12, priority: 3, req: [['React', 3]] },
  { title: 'Оптимизировать запросы отчёта по загрузке', description: 'Добавить индексы и переписать агрегирующие запросы.', hours: 10, priority: 2, req: [['SQL и проектирование БД', 4]] },
  { title: 'Настроить конвейер сборки и развёртывания', description: 'Контейнеризация приложения и автоматический запуск тестов при каждом изменении.', hours: 16, priority: 2, req: [['Docker и CI/CD', 4]] },
  { title: 'Провести регрессионное тестирование релиза', description: 'Выполнить набор тест-кейсов по основным сценариям, оформить отчёт.', hours: 14, priority: 2, req: [['Тестирование', 4]] },
  { title: 'Подготовить макеты панели руководителя', description: 'Прототип экранов, проверка на удобство, передача в разработку.', hours: 18, priority: 3, req: [['UI/UX-дизайн', 4]] },
  { title: 'Описать требования к модулю отчётности', description: 'Сбор требований, диаграммы вариантов использования, спецификация.', hours: 20, priority: 3, req: [['Системный анализ', 4], ['Техническая документация', 3]] },
  { title: 'Анализ причин просрочки задач за квартал', description: 'Выгрузка данных, расчёт метрик, визуализация в виде отчёта.', hours: 16, priority: 3, req: [['Аналитика данных', 4], ['Python', 3]] },
  { title: 'Провести аудит прав доступа', description: 'Проверка ролевой модели, сроков действия токенов и политики паролей.', hours: 12, priority: 1, req: [['Информационная безопасность', 4]] },
  { title: 'Исправить ошибку в отображении диаграммы загрузки', description: 'Диаграмма некорректно масштабируется при значениях выше 100 %.', hours: 4, priority: 1, req: [['React', 3], ['TypeScript', 3]] },
  { title: 'Реализовать экспорт отчёта в CSV', description: 'Серверная выгрузка с учётом фильтров и кодировки UTF-8.', hours: 8, priority: 3, req: [['Node.js', 3]] },
  { title: 'Автоматизированные тесты API', description: 'Покрыть тестами основные сценарии назначения и смены статусов.', hours: 16, priority: 3, req: [['Тестирование', 3], ['TypeScript', 2]] },
  { title: 'Обновить руководство пользователя', description: 'Добавить описание новых экранов и сценариев работы с рекомендациями.', hours: 10, priority: 4, req: [['Техническая документация', 3]] },
  { title: 'Настроить резервное копирование базы данных', description: 'Ежедневные копии, проверка восстановления, оповещения об ошибках.', hours: 8, priority: 2, req: [['Docker и CI/CD', 3], ['SQL и проектирование БД', 3]] },
  { title: 'Проектирование схемы данных для модуля навыков', description: 'Нормализация, ограничения целостности, план миграции.', hours: 12, priority: 2, req: [['SQL и проектирование БД', 4], ['Системный анализ', 3]] },
  { title: 'Компонент канбан-доски', description: 'Перетаскивание карточек между статусами с сохранением на сервере.', hours: 20, priority: 2, req: [['React', 4], ['TypeScript', 3]] },
  { title: 'Мониторинг доступности сервиса', description: 'Метрики, оповещения и панель мониторинга.', hours: 14, priority: 3, req: [['Docker и CI/CD', 3]] },
  { title: 'Расчёт прогноза загрузки команды', description: 'Модель прогноза загрузки на два месяца по истории выполнения задач.', hours: 22, priority: 3, req: [['Python', 4], ['Аналитика данных', 3]] },
  { title: 'Разработать модуль уведомлений', description: 'Оповещения исполнителя о новых назначениях и приближении срока.', hours: 18, priority: 3, req: [['Node.js', 3], ['TypeScript', 3]] },
  { title: 'Исследование удобства интерфейса', description: 'Сессии с пользователями, сбор замечаний, рекомендации по улучшению.', hours: 12, priority: 4, req: [['UI/UX-дизайн', 3]] },
  { title: 'Защита от подбора паролей', description: 'Ограничение частоты попыток входа и журналирование событий.', hours: 8, priority: 2, req: [['Информационная безопасность', 3], ['Node.js', 3]] },
  { title: 'Тестирование производительности', description: 'Нагрузочные сценарии для эндпоинтов распределения задач.', hours: 12, priority: 3, req: [['Тестирование', 3]] },
  { title: 'Доработка карточки сотрудника', description: 'Редактирование навыков и уровней, индикатор загрузки.', hours: 10, priority: 3, req: [['React', 3]] },
  { title: 'Спецификация интеграции с календарём', description: 'Описать обмен данными об отпусках и рабочем времени.', hours: 10, priority: 4, req: [['Системный анализ', 3]] },
  { title: 'Миграция данных из таблиц Excel', description: 'Скрипт загрузки задач и сотрудников с проверкой дубликатов.', hours: 12, priority: 3, req: [['Python', 3], ['SQL и проектирование БД', 3]] },
  { title: 'Проверка зависимостей на уязвимости', description: 'Автоматический анализ и обновление проблемных библиотек.', hours: 6, priority: 2, req: [['Информационная безопасность', 3]] },
  { title: 'Стилизация тёмной темы', description: 'Цветовая схема и проверка контрастности элементов.', hours: 6, priority: 4, req: [['UI/UX-дизайн', 3], ['React', 2]] },
  { title: 'Каталог типовых ошибок', description: 'Справочник для службы поддержки с описанием диагностики.', hours: 8, priority: 4, req: [['Техническая документация', 2]] },
  { title: 'Мелкие правки текстов интерфейса', description: 'Единообразие терминов и исправление опечаток.', hours: 3, priority: 4, req: [] },
  { title: 'Подготовка демонстрационных данных', description: 'Сценарии наполнения тестового стенда.', hours: 5, priority: 4, req: [['SQL и проектирование БД', 2]] },
  { title: 'Настроить журналирование действий пользователей', description: 'Структурированные журналы и ротация файлов.', hours: 9, priority: 3, req: [['Node.js', 3]] },
  { title: 'Ревизия покрытия автотестами', description: 'Анализ покрытия и план доработки тестов.', hours: 7, priority: 3, req: [['Тестирование', 3]] },
  { title: 'Панель метрик эффективности распределения', description: 'Показатели соблюдения сроков и равномерности загрузки.', hours: 16, priority: 2, req: [['React', 3], ['Аналитика данных', 2]] },
];

function addDays(d: Date, n: number): string {
  return new Date(d.getTime() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function seedDatabase(db: Db, now: Date = new Date()): Promise<void> {
  const repo = new Repo(db);
  const rng = makeRng(42);
  const skillIds = new Map<string, number>();
  const hashes = new Map<string, string>();
  for (const [key, acc] of Object.entries(DEMO_ACCOUNTS)) hashes.set(key, await hashPassword(acc.password));
  const demoHash = (e: EmpSeed) => hashes.get(e.role === 'employee' && e.email === DEMO_ACCOUNTS.employee.email ? 'employee' : e.role) ?? hashes.get('employee')!;

  tx(db, () => {
    for (const [name, category] of SKILLS) {
      const r = repo.run('INSERT INTO skills(name, category) VALUES(?,?)', name, category);
      skillIds.set(name, Number(r.lastInsertRowid));
    }
    for (const e of EMPLOYEES) {
      const r = repo.run(
        'INSERT INTO employees(name, email, password_hash, role, position, capacity_hours_week, speed_factor) VALUES(?,?,?,?,?,?,?)',
        e.name,
        e.email,
        demoHash(e),
        e.role,
        e.position,
        e.capacity,
        e.speed,
      );
      const id = Number(r.lastInsertRowid);
      for (const [skill, level] of Object.entries(e.skills)) {
        repo.run('INSERT INTO employee_skills(employee_id, skill_id, level) VALUES(?,?,?)', id, skillIds.get(skill)!, level);
      }
    }
    // Сотрудник в отпуске — для демонстрации ограничения доступности
    repo.run("UPDATE employees SET available = 0 WHERE email = 'zakharov@smartassign.local'");
  });

  const empRows = repo.all<{ id: number; name: string; email: string; capacity_hours_week: number }>('SELECT id, name, email, capacity_hours_week FROM employees');
  const managerId = empRows.find((e) => e.email === DEMO_ACCOUNTS.manager.email)!.id;
  const inputs = repo.employeeInputs();

  tx(db, () => {
    TASKS.forEach((tpl, idx) => {
      const r = repo.run(
        'INSERT INTO tasks(title, description, priority, estimate_hours, deadline, created_by, created_at) VALUES(?,?,?,?,?,?,?)',
        tpl.title,
        tpl.description,
        tpl.priority,
        tpl.hours,
        null,
        managerId,
        addDays(now, -rng.int(12, 40)) + ' 09:00:00',
      );
      const taskId = Number(r.lastInsertRowid);
      repo.setRequirements(taskId, tpl.req.map(([n, l]) => ({ skillId: skillIds.get(n)!, minLevel: l })));
      repo.event(taskId, managerId, 'created', 'Задача создана');

      // Первые 14 — завершённые (история), затем задачи в работе, назначенные и новые
      const feasible = inputs.filter((e) => e.available && tpl.req.every(([n, l]) => (e.skills.get(skillIds.get(n)!) ?? 0) >= l));
      const pickEmployee = () => (feasible.length ? feasible[rng.int(0, feasible.length - 1)] : null);
      if (idx < 14) {
        const emp = pickEmployee();
        if (!emp) return;
        const doneAgo = rng.int(2, 25);
        const late = rng.next() < 0.18;
        const actual = Number((tpl.hours * rng.range(0.75, 1.3)).toFixed(1));
        const deadline = late ? addDays(now, -doneAgo - rng.int(1, 3)) : addDays(now, -doneAgo + rng.int(1, 6));
        repo.run(
          "UPDATE tasks SET assignee_id = ?, assigned_by = 'manual', status = 'done', deadline = ?, started_at = ?, completed_at = ?, actual_hours = ? WHERE id = ?",
          emp.id,
          deadline,
          addDays(now, -doneAgo - 6) + 'T09:00:00.000Z',
          addDays(now, -doneAgo) + 'T16:00:00.000Z',
          actual,
          taskId,
        );
        repo.run(
          'UPDATE employees SET done_count = done_count + 1, on_time_count = on_time_count + ?, speed_factor = ? WHERE id = ?',
          late ? 0 : 1,
          0.8 * (repo.get<{ speed_factor: number }>('SELECT speed_factor FROM employees WHERE id = ?', emp.id)!.speed_factor) + 0.2 * Math.min(2, Math.max(0.5, tpl.hours / actual)),
          emp.id,
        );
        repo.event(taskId, managerId, 'assigned', `Исполнитель: ${emp.name} (вручную)`);
        repo.event(taskId, emp.id, 'status', 'Статус: review → done');
      } else if (idx < 28) {
        const emp = pickEmployee();
        if (!emp) return;
        const status = idx < 19 ? 'in_progress' : idx < 21 ? 'review' : 'assigned';
        repo.run(
          'UPDATE tasks SET assignee_id = ?, assigned_by = ?, status = ?, deadline = ?, started_at = ? WHERE id = ?',
          emp.id,
          idx % 2 ? 'auto' : 'manual',
          status,
          addDays(now, rng.int(2, 12)),
          status === 'assigned' ? null : addDays(now, -rng.int(1, 5)) + 'T09:00:00.000Z',
          taskId,
        );
        repo.event(taskId, managerId, 'assigned', `Исполнитель: ${emp.name}`);
      } else {
        const deadline = tpl.priority === 1 ? addDays(now, rng.int(2, 4)) : addDays(now, rng.int(5, 25));
        repo.run('UPDATE tasks SET deadline = ? WHERE id = ?', deadline, taskId);
      }
    });
  });
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM employees').get() as { n: number }).n;
  if (n > 0) return false;
  await seedDatabase(db);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const reset = process.argv.includes('--reset');
  const path = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  if (reset) for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
  const db = openDb(path);
  const seeded = await seedIfEmpty(db);
  console.log(seeded ? 'База данных заполнена демонстрационными данными.' : 'База данных уже содержит данные.');
}
