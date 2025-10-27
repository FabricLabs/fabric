#include "threads.h"
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>

// Global debug flag
static int debug_enabled = 0;

// Thread safety debugging
void fabric_thread_safety_debug_print(const char *message)
{
  if (debug_enabled)
  {
    pthread_t tid = pthread_self();
    fprintf(stderr, "[Thread %lu] %s\n", (unsigned long)tid, message);
  }
}

void fabric_thread_safety_set_debug(int enabled)
{
  debug_enabled = enabled;
}

// Thread ID utilities
FabricThreadID fabric_get_current_thread_id(void)
{
  return pthread_self();
}

int fabric_thread_id_equal(FabricThreadID id1, FabricThreadID id2)
{
  return pthread_equal(id1, id2);
}

int fabric_thread_id_is_current(FabricThreadID id)
{
  return pthread_equal(id, pthread_self());
}

// Mutex operations
ThreadError fabric_mutex_init(FabricMutex *mutex, const char *name)
{
  if (!mutex || !name)
  {
    return THREAD_ERROR_MUTEX_INIT_FAILED;
  }

  pthread_mutexattr_t attr;
  if (pthread_mutexattr_init(&attr) != 0)
  {
    return THREAD_ERROR_MUTEX_INIT_FAILED;
  }

  // Set mutex as recursive to allow same thread to lock multiple times
  if (pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE) != 0)
  {
    pthread_mutexattr_destroy(&attr);
    return THREAD_ERROR_MUTEX_INIT_FAILED;
  }

  if (pthread_mutex_init(&mutex->mutex, &attr) != 0)
  {
    pthread_mutexattr_destroy(&attr);
    return THREAD_ERROR_MUTEX_INIT_FAILED;
  }

  pthread_mutexattr_destroy(&attr);

  mutex->name = name;
  mutex->initialized = 1;

  fabric_thread_safety_debug_print("Mutex initialized");
  return THREAD_SUCCESS;
}

ThreadError fabric_mutex_lock(FabricMutex *mutex)
{
  if (!mutex || !mutex->initialized)
  {
    return THREAD_ERROR_MUTEX_LOCK_FAILED;
  }

  if (pthread_mutex_lock(&mutex->mutex) != 0)
  {
    return THREAD_ERROR_MUTEX_LOCK_FAILED;
  }

  fabric_thread_safety_debug_print("Mutex locked");
  return THREAD_SUCCESS;
}

ThreadError fabric_mutex_unlock(FabricMutex *mutex)
{
  if (!mutex || !mutex->initialized)
  {
    return THREAD_ERROR_MUTEX_UNLOCK_FAILED;
  }

  if (pthread_mutex_unlock(&mutex->mutex) != 0)
  {
    return THREAD_ERROR_MUTEX_UNLOCK_FAILED;
  }

  fabric_thread_safety_debug_print("Mutex unlocked");
  return THREAD_SUCCESS;
}

ThreadError fabric_mutex_destroy(FabricMutex *mutex)
{
  if (!mutex || !mutex->initialized)
  {
    return THREAD_ERROR_MUTEX_DESTROY_FAILED;
  }

  if (pthread_mutex_destroy(&mutex->mutex) != 0)
  {
    return THREAD_ERROR_MUTEX_DESTROY_FAILED;
  }

  mutex->initialized = 0;
  mutex->name = NULL;

  fabric_thread_safety_debug_print("Mutex destroyed");
  return THREAD_SUCCESS;
}

int fabric_mutex_is_initialized(const FabricMutex *mutex)
{
  return mutex && mutex->initialized;
}

// Read-write lock operations
ThreadError fabric_rwlock_init(FabricRWLock *rwlock, const char *name)
{
  if (!rwlock || !name)
  {
    return THREAD_ERROR_RWLOCK_INIT_FAILED;
  }

  if (pthread_rwlock_init(&rwlock->rwlock, NULL) != 0)
  {
    return THREAD_ERROR_RWLOCK_INIT_FAILED;
  }

  rwlock->name = name;
  rwlock->initialized = 1;

  fabric_thread_safety_debug_print("RWLock initialized");
  return THREAD_SUCCESS;
}

ThreadError fabric_rwlock_rdlock(FabricRWLock *rwlock)
{
  if (!rwlock || !rwlock->initialized)
  {
    return THREAD_ERROR_RWLOCK_RDLOCK_FAILED;
  }

  if (pthread_rwlock_rdlock(&rwlock->rwlock) != 0)
  {
    return THREAD_ERROR_RWLOCK_RDLOCK_FAILED;
  }

  fabric_thread_safety_debug_print("RWLock read locked");
  return THREAD_SUCCESS;
}

ThreadError fabric_rwlock_wrlock(FabricRWLock *rwlock)
{
  if (!rwlock || !rwlock->initialized)
  {
    return THREAD_ERROR_RWLOCK_WRLOCK_FAILED;
  }

  if (pthread_rwlock_wrlock(&rwlock->rwlock) != 0)
  {
    return THREAD_ERROR_RWLOCK_WRLOCK_FAILED;
  }

  fabric_thread_safety_debug_print("RWLock write locked");
  return THREAD_SUCCESS;
}

ThreadError fabric_rwlock_unlock(FabricRWLock *rwlock)
{
  if (!rwlock || !rwlock->initialized)
  {
    return THREAD_ERROR_RWLOCK_UNLOCK_FAILED;
  }

  if (pthread_rwlock_unlock(&rwlock->rwlock) != 0)
  {
    return THREAD_ERROR_RWLOCK_UNLOCK_FAILED;
  }

  fabric_thread_safety_debug_print("RWLock unlocked");
  return THREAD_SUCCESS;
}

ThreadError fabric_rwlock_destroy(FabricRWLock *rwlock)
{
  if (!rwlock || !rwlock->initialized)
  {
    return THREAD_ERROR_RWLOCK_DESTROY_FAILED;
  }

  if (pthread_rwlock_destroy(&rwlock->rwlock) != 0)
  {
    return THREAD_ERROR_RWLOCK_DESTROY_FAILED;
  }

  rwlock->initialized = 0;
  rwlock->name = NULL;

  fabric_thread_safety_debug_print("RWLock destroyed");
  return THREAD_SUCCESS;
}

int fabric_rwlock_is_initialized(const FabricRWLock *rwlock)
{
  return rwlock && rwlock->initialized;
}

// Condition variable operations
ThreadError fabric_condition_init(FabricCondition *cond, const char *name)
{
  if (!cond || !name)
  {
    return THREAD_ERROR_COND_INIT_FAILED;
  }

  if (pthread_cond_init(&cond->cond, NULL) != 0)
  {
    return THREAD_ERROR_COND_INIT_FAILED;
  }

  if (pthread_mutex_init(&cond->mutex, NULL) != 0)
  {
    pthread_cond_destroy(&cond->cond);
    return THREAD_ERROR_COND_INIT_FAILED;
  }

  cond->name = name;
  cond->initialized = 1;

  fabric_thread_safety_debug_print("Condition initialized");
  return THREAD_SUCCESS;
}

ThreadError fabric_condition_wait(FabricCondition *cond, FabricMutex *mutex)
{
  if (!cond || !cond->initialized || !mutex || !mutex->initialized)
  {
    return THREAD_ERROR_COND_WAIT_FAILED;
  }

  if (pthread_cond_wait(&cond->cond, &mutex->mutex) != 0)
  {
    return THREAD_ERROR_COND_WAIT_FAILED;
  }

  fabric_thread_safety_debug_print("Condition wait completed");
  return THREAD_SUCCESS;
}

ThreadError fabric_condition_signal(FabricCondition *cond)
{
  if (!cond || !cond->initialized)
  {
    return THREAD_ERROR_COND_SIGNAL_FAILED;
  }

  if (pthread_cond_signal(&cond->cond) != 0)
  {
    return THREAD_ERROR_COND_SIGNAL_FAILED;
  }

  fabric_thread_safety_debug_print("Condition signaled");
  return THREAD_SUCCESS;
}

ThreadError fabric_condition_broadcast(FabricCondition *cond)
{
  if (!cond || !cond->initialized)
  {
    return THREAD_ERROR_COND_SIGNAL_FAILED;
  }

  if (pthread_cond_broadcast(&cond->cond) != 0)
  {
    return THREAD_ERROR_COND_SIGNAL_FAILED;
  }

  fabric_thread_safety_debug_print("Condition broadcast");
  return THREAD_SUCCESS;
}

ThreadError fabric_condition_destroy(FabricCondition *cond)
{
  if (!cond || !cond->initialized)
  {
    return THREAD_ERROR_COND_DESTROY_FAILED;
  }

  if (pthread_cond_destroy(&cond->cond) != 0)
  {
    return THREAD_ERROR_COND_DESTROY_FAILED;
  }

  if (pthread_mutex_destroy(&cond->mutex) != 0)
  {
    return THREAD_ERROR_COND_DESTROY_FAILED;
  }

  cond->initialized = 0;
  cond->name = NULL;

  fabric_thread_safety_debug_print("Condition destroyed");
  return THREAD_SUCCESS;
}

int fabric_condition_is_initialized(const FabricCondition *cond)
{
  return cond && cond->initialized;
}

// Atomic operations for int64
ThreadError fabric_atomic_int64_init(FabricAtomicInt64 *atomic, const char *name, int64_t initial_value)
{
  if (!atomic || !name)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_init(&atomic->mutex, name) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  atomic->value = initial_value;
  atomic->name = name;
  atomic->initialized = 1;

  fabric_thread_safety_debug_print("Atomic int64 initialized");
  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int64_set(FabricAtomicInt64 *atomic, int64_t value)
{
  if (!atomic || !atomic->initialized)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value = value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int64_get(FabricAtomicInt64 *atomic, int64_t *value)
{
  if (!atomic || !atomic->initialized || !value)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  *value = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int64_add(FabricAtomicInt64 *atomic, int64_t delta, int64_t *result)
{
  if (!atomic || !atomic->initialized || !result)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value += delta;
  *result = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int64_sub(FabricAtomicInt64 *atomic, int64_t delta, int64_t *result)
{
  if (!atomic || !atomic->initialized || !result)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value -= delta;
  *result = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int64_inc(FabricAtomicInt64 *atomic, int64_t *result)
{
  return fabric_atomic_int64_add(atomic, 1, result);
}

ThreadError fabric_atomic_int64_dec(FabricAtomicInt64 *atomic, int64_t *result)
{
  return fabric_atomic_int64_sub(atomic, 1, result);
}

ThreadError fabric_atomic_int64_destroy(FabricAtomicInt64 *atomic)
{
  if (!atomic || !atomic->initialized)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_destroy(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  atomic->initialized = 0;
  atomic->name = NULL;

  fabric_thread_safety_debug_print("Atomic int64 destroyed");
  return THREAD_SUCCESS;
}

int fabric_atomic_int64_is_initialized(const FabricAtomicInt64 *atomic)
{
  return atomic && atomic->initialized;
}

// Atomic operations for int32
ThreadError fabric_atomic_int32_init(FabricAtomicInt32 *atomic, const char *name, int32_t initial_value)
{
  if (!atomic || !name)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_init(&atomic->mutex, name) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  atomic->value = initial_value;
  atomic->name = name;
  atomic->initialized = 1;

  fabric_thread_safety_debug_print("Atomic int32 initialized");
  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int32_set(FabricAtomicInt32 *atomic, int32_t value)
{
  if (!atomic || !atomic->initialized)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value = value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int32_get(FabricAtomicInt32 *atomic, int32_t *value)
{
  if (!atomic || !atomic->initialized || !value)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  *value = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int32_add(FabricAtomicInt32 *atomic, int32_t delta, int32_t *result)
{
  if (!atomic || !atomic->initialized || !result)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value += delta;
  *result = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int32_sub(FabricAtomicInt32 *atomic, int32_t delta, int32_t *result)
{
  if (!atomic || !atomic->initialized || !result)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_lock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }
  atomic->value -= delta;
  *result = atomic->value;
  if (fabric_mutex_unlock(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  return THREAD_SUCCESS;
}

ThreadError fabric_atomic_int32_inc(FabricAtomicInt32 *atomic, int32_t *result)
{
  return fabric_atomic_int32_add(atomic, 1, result);
}

ThreadError fabric_atomic_int32_dec(FabricAtomicInt32 *atomic, int32_t *result)
{
  return fabric_atomic_int32_sub(atomic, 1, result);
}

ThreadError fabric_atomic_int32_destroy(FabricAtomicInt32 *atomic)
{
  if (!atomic || !atomic->initialized)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  if (fabric_mutex_destroy(&atomic->mutex) != THREAD_SUCCESS)
  {
    return THREAD_ERROR_ATOMIC_OPERATION_FAILED;
  }

  atomic->initialized = 0;
  atomic->name = NULL;

  fabric_thread_safety_debug_print("Atomic int32 destroyed");
  return THREAD_SUCCESS;
}

int fabric_atomic_int32_is_initialized(const FabricAtomicInt32 *atomic)
{
  return atomic && atomic->initialized;
}
